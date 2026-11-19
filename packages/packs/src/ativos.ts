import { createHash } from 'node:crypto'
import sharp from 'sharp'

// ATIVOS do tenant (imagens), no plano de controle. Conteúdo endereçado pelo SHA-256 (o mesmo arquivo é um só, e a URL nunca muda de conteúdo: cache eterno).
// Regras que valem como contrato: (1) o TIPO vem dos bytes (assinatura do arquivo), nunca do nome nem do que o cliente disser; (2) só png, jpeg, gif e webp (SVG fica de fora: carrega script);
// (3) dimensões lidas do cabeçalho e limitadas (bomba de descompressão); (4) limites por arquivo e por tenant; (5) tudo é do tenant: nome e conteúdo de um nunca aparecem para outro.

export const DDL_ATIVOS = `
CREATE TABLE IF NOT EXISTS plataforma.ativo (
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 120),
  tipo text NOT NULL CHECK (tipo IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  largura integer NOT NULL CHECK (largura BETWEEN 1 AND 16384),
  altura integer NOT NULL CHECK (altura BETWEEN 1 AND 16384),
  tamanho integer NOT NULL CHECK (tamanho BETWEEN 1 AND 8388608),
  conteudo bytea NOT NULL,
  autor text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, hash)
);
CREATE TABLE IF NOT EXISTS plataforma.ativo_variante (
  tenant_id uuid NOT NULL,
  hash text NOT NULL,
  largura integer NOT NULL CHECK (largura BETWEEN 16 AND 4096),
  conteudo bytea NOT NULL,
  PRIMARY KEY (tenant_id, hash, largura),
  FOREIGN KEY (tenant_id, hash) REFERENCES plataforma.ativo (tenant_id, hash) ON DELETE CASCADE
);
`

export type TipoImagem = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
export const EXTENSAO: Record<TipoImagem, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
export const LARGURAS_VARIANTES = [160, 480, 960, 1920] as const
export const LADO_MAXIMO_SERVIDO = 2400
export const LIMITES_ATIVOS = { bytesPorArquivo: 2 * 1024 * 1024, arquivosPorTenant: 200, bytesPorTenant: 50 * 1024 * 1024, ladoMax: 8000, megapixelsMax: 40 }

/** o que o arquivo É (pelos bytes) e as dimensões do cabeçalho; null se não for uma das quatro imagens ou o cabeçalho estiver truncado/ruim */
export function detectaImagem(b: Uint8Array): { tipo: TipoImagem; largura: number; altura: number } | null {
  const u16 = (o: number) => (b[o]! << 8) | b[o + 1]!, u32 = (o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0, l16 = (o: number) => b[o]! | (b[o + 1]! << 8)
  const asc = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n))
  if (b.length >= 24 && b[0] === 0x89 && asc(1, 3) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a && asc(12, 4) === 'IHDR') return { tipo: 'image/png', largura: u32(16), altura: u32(20) }
  if (b.length >= 10 && (asc(0, 6) === 'GIF87a' || asc(0, 6) === 'GIF89a')) return { tipo: 'image/gif', largura: l16(6), altura: l16(8) }
  if (b.length >= 30 && asc(0, 4) === 'RIFF' && asc(8, 4) === 'WEBP') {
    const f = asc(12, 4)
    if (f === 'VP8X') return { tipo: 'image/webp', largura: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), altura: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) }
    if (f === 'VP8L' && b[20] === 0x2f) { const v = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24); return { tipo: 'image/webp', largura: (v & 0x3fff) + 1, altura: ((v >>> 14) & 0x3fff) + 1 } }
    if (f === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { tipo: 'image/webp', largura: l16(26) & 0x3fff, altura: l16(28) & 0x3fff }
    return null
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) { // JPEG: percorre os segmentos até um SOF
    let o = 2
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) return null
      const m = b[o + 1]!; if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue }
      if (m === 0xff) { o++; continue }
      const len = u16(o + 2); if (len < 2) return null
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { tipo: 'image/jpeg', altura: u16(o + 5), largura: u16(o + 7) }
      o += 2 + len
    }
  }
  return null
}

/** tira os METADADOS que vazam (localização do EXIF, modelo da câmera, comentários, XMP, miniatura embutida) sem recodificar: a imagem em si fica byte a byte igual. null se a estrutura estiver quebrada.
 * png: remove tEXt/zTXt/iTXt/eXIf/tIME; jpeg: remove APP1 (EXIF/XMP), APP13 (IPTC), COM e os APPn desconhecidos (mantém JFIF, ICC e Adobe); gif: remove comentários e extensões de texto; webp: remove EXIF e XMP e zera as flags. */
export function limpaMetadados(b: Uint8Array, tipo: TipoImagem): Buffer | null {
  const buf = Buffer.from(b)
  if (tipo === 'image/png') {
    const fora = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']), partes: Buffer[] = [buf.subarray(0, 8)]; let o = 8, viuIend = false
    while (o + 12 <= buf.length) {
      const len = buf.readUInt32BE(o), fim = o + 12 + len; if (fim > buf.length || len > 0x7fffffff) return null
      const nome = buf.toString('latin1', o + 4, o + 8); if (!/^[A-Za-z]{4}$/.test(nome)) return null
      if (!fora.has(nome)) partes.push(buf.subarray(o, fim)); o = fim
      if (nome === 'IEND') { viuIend = true; break }
    }
    return viuIend ? Buffer.concat(partes) : null
  }
  if (tipo === 'image/jpeg') {
    const partes: Buffer[] = [buf.subarray(0, 2)]; let o = 2
    while (o + 4 <= buf.length) {
      if (buf[o] !== 0xff) return null
      const m = buf[o + 1]!; if (m === 0xff) { o++; continue }
      if (m === 0xd9) { partes.push(buf.subarray(o)); return Buffer.concat(partes) }
      if (m === 0xda) { partes.push(buf.subarray(o)); return Buffer.concat(partes) } // dados da imagem: o resto vai como está
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { partes.push(buf.subarray(o, o + 2)); o += 2; continue }
      const len = buf.readUInt16BE(o + 2); if (len < 2 || o + 2 + len > buf.length) return null
      const mantem = !(m === 0xfe || m === 0xe1 || m === 0xed || (m >= 0xe3 && m <= 0xef && m !== 0xee)) // fora: COM, APP1, APP13 e APP3–APP15 (menos o Adobe, APP14); ficam APP0 (JFIF) e APP2 (ICC)
      if (mantem) partes.push(buf.subarray(o, o + 2 + len)); o += 2 + len
    }
    return null
  }
  if (tipo === 'image/gif') {
    const partes: Buffer[] = []; if (buf.length < 13) return null
    const flags = buf[10]!, tabela = flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0; let o = 13 + tabela; if (o > buf.length) return null
    partes.push(buf.subarray(0, o))
    const subBlocos = (i: number): number => { while (i < buf.length && buf[i] !== 0) i += 1 + buf[i]!; return i + 1 } // índice logo depois do terminador
    while (o < buf.length) {
      const t = buf[o]!
      if (t === 0x3b) { partes.push(buf.subarray(o, o + 1)); return Buffer.concat(partes) }
      if (t === 0x21) { // extensão: 0xFE comentário e 0x01 texto simples saem; as demais (gráficos, NETSCAPE) ficam
        const rotulo = buf[o + 1]!, fim = rotulo === 0xf9 ? o + 8 : subBlocos(o + 2 + (rotulo === 0xff || rotulo === 0x01 ? 1 + buf[o + 2]! : 0)); if (fim > buf.length) return null
        if (rotulo !== 0xfe && rotulo !== 0x01) partes.push(buf.subarray(o, fim)); o = fim; continue
      }
      if (t === 0x2c) { // imagem: descritor de 10 bytes, tabela local opcional, código mínimo e sub-blocos
        if (o + 10 > buf.length) return null; const f = buf[o + 9]!, tab = f & 0x80 ? 3 * 2 ** ((f & 7) + 1) : 0, fim = subBlocos(o + 10 + tab + 1); if (fim > buf.length) return null
        partes.push(buf.subarray(o, fim)); o = fim; continue
      }
      return null
    }
    return null
  }
  // webp (RIFF): reescreve a lista de pedaços sem EXIF e XMP e acerta o tamanho e as flags do VP8X
  if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null
  const partes: Buffer[] = []; let o = 12
  while (o + 8 <= buf.length) {
    const nome = buf.toString('latin1', o, o + 4), len = buf.readUInt32LE(o + 4), fim = o + 8 + len + (len & 1); if (o + 8 + len > buf.length) return null
    if (nome !== 'EXIF' && nome !== 'XMP ') { const p = Buffer.from(buf.subarray(o, Math.min(fim, buf.length))); if (nome === 'VP8X') p[8] = p[8]! & ~0x0c; partes.push(p) } // bits 3 (EXIF) e 2 (XMP) do VP8X
    o = fim
  }
  const corpo = Buffer.concat(partes), cab = Buffer.from('RIFF\0\0\0\0WEBP', 'latin1'); cab.writeUInt32LE(corpo.length + 4, 4)
  return Buffer.concat([cab, corpo])
}


export type Processada = { bytes: Buffer; largura: number; altura: number; variantes: Array<{ largura: number; bytes: Buffer }>; reencodou: boolean }
/** decodifica DE VERDADE (sharp/libvips): recusa o que não decodifica, gira conforme a orientação EXIF (a limpeza a apagou), reduz o que passa de 2400 px de lado e gera as versões menores (webp, larguras de `LARGURAS_VARIANTES` menores que a imagem).
 * Só recodifica quando precisa (orientação ou tamanho): do contrário o arquivo segue byte a byte como veio. Animações (gif/webp com vários quadros) não são tocadas. null = não decodifica. */
export async function processaImagem(bytes: Buffer, tipo: TipoImagem, megapixelsMax = LIMITES_ATIVOS.megapixelsMax): Promise<Processada | null> {
  try {
    const abre = (b: Buffer, animado = false) => sharp(b, { limitInputPixels: megapixelsMax * 1_000_000, failOn: 'error', animated: animado })
    const meta = await abre(bytes, true).metadata()
    if (!meta.width || !meta.height) return null
    if ((meta.pages ?? 1) > 1) return { bytes, largura: meta.width, altura: meta.pageHeight ?? meta.height, variantes: [], reencodou: false }
    const orient = meta.orientation ?? 1, troca = orient >= 5, l0 = troca ? meta.height : meta.width, a0 = troca ? meta.width : meta.height
    const reduz = Math.max(l0, a0) > LADO_MAXIMO_SERVIDO, reencodou = orient > 1 || reduz
    let final = bytes, largura = l0, altura = a0
    if (reencodou) {
      let p = abre(bytes).rotate(); if (reduz) p = p.resize({ width: LADO_MAXIMO_SERVIDO, height: LADO_MAXIMO_SERVIDO, fit: 'inside', withoutEnlargement: true })
      p = tipo === 'image/jpeg' ? p.jpeg({ quality: 88 }) : tipo === 'image/png' ? p.png({ compressionLevel: 9 }) : tipo === 'image/webp' ? p.webp({ quality: 88 }) : p.gif()
      const r = await p.toBuffer({ resolveWithObject: true }); final = r.data; largura = r.info.width; altura = r.info.height // sem `withMetadata`: o resultado nasce sem metadados
    }
    const variantes: Processada['variantes'] = []
    for (const w of LARGURAS_VARIANTES) if (w < largura) variantes.push({ largura: w, bytes: await abre(final).resize({ width: w }).webp({ quality: 78 }).toBuffer() })
    return { bytes: final, largura, altura, variantes, reencodou }
  } catch { return null }
}

export type Ativo = { id: string; nome: string; tipo: TipoImagem; largura: number; altura: number; tamanho: number; criadoEm: string; autor: string; caminho: string; /** larguras (px) das versões menores (`<hash>.webp?w=<largura>`) */ variantes: number[]; /** a versão pequena para listas (ou o próprio arquivo, se não há) */ miniatura: string }
export type ResultadoAtivo = { ok: true; ativo: Ativo; novo: boolean; /** bytes de metadados removidos (0 = nada a tirar) */ removidos: number; /** a imagem foi girada (orientação EXIF) e/ou reduzida a 2400 px */ ajustada: boolean } | { ok: false; erro: string }
type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>
export const caminhoDoAtivo = (hash: string, tipo: TipoImagem) => `/_polaris/img/${hash}.${EXTENSAO[tipo]}`
export const caminhoDaVariante = (hash: string, largura: number) => `/_polaris/img/${hash}.webp?w=${largura}`
const NOME = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/g
const linha = (r: Record<string, unknown>, variantes: number[] = []): Ativo => ({ id: r.hash as string, nome: r.nome as string, tipo: r.tipo as TipoImagem, largura: Number(r.largura), altura: Number(r.altura), tamanho: Number(r.tamanho), criadoEm: new Date(r.criado_em as string).toISOString(), autor: r.autor as string, caminho: caminhoDoAtivo(r.hash as string, r.tipo as TipoImagem), variantes, miniatura: variantes.includes(160) ? caminhoDaVariante(r.hash as string, 160) : caminhoDoAtivo(r.hash as string, r.tipo as TipoImagem) })
const COLS = 'hash, nome, tipo, largura, altura, tamanho, autor, criado_em'

export function criaAtivos(o: { q: Q; limites?: Partial<typeof LIMITES_ATIVOS> }) {
  const lim = { ...LIMITES_ATIVOS, ...o.limites }, q = o.q
  return {
    /** `dados` em base64 (o Studio fala JSON); idempotente: o mesmo conteúdo no mesmo tenant devolve o ativo que já existe */
    async salva(tenantId: string, autor: string, e: { nome: string; dados: string }): Promise<ResultadoAtivo> {
      const nome = String(e.nome ?? '').replace(NOME, ' ').trim().slice(0, 120); if (!nome) return { ok: false, erro: 'dê um nome ao arquivo' }
      if (typeof e.dados !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(e.dados)) return { ok: false, erro: 'os dados do arquivo não são base64 válido' }
      if (e.dados.length > Math.ceil((lim.bytesPorArquivo * 4) / 3) + 8) return { ok: false, erro: `o arquivo passa de ${Math.round(lim.bytesPorArquivo / 1024)} KB` }
      const original = Buffer.from(e.dados, 'base64'); if (!original.length || original.length > lim.bytesPorArquivo) return { ok: false, erro: `o arquivo precisa ter de 1 byte a ${Math.round(lim.bytesPorArquivo / 1024)} KB` }
      const img = detectaImagem(original); if (!img) return { ok: false, erro: 'só imagens png, jpeg, gif ou webp (o tipo é lido do próprio arquivo)' }
      if (img.largura < 1 || img.altura < 1 || img.largura > lim.ladoMax || img.altura > lim.ladoMax || img.largura * img.altura > lim.megapixelsMax * 1_000_000) return { ok: false, erro: `dimensões fora do limite (${img.largura}×${img.altura}; máximo ${lim.ladoMax} px de lado e ${lim.megapixelsMax} megapixels)` }
      // 1º decodifica o ORIGINAL (a orientação EXIF só existe nele) e, se precisar, gira/reduz e recodifica sem metadados; 2º o que não foi recodificado passa pela limpeza byte a byte
      const proc = await processaImagem(original, img.tipo, lim.megapixelsMax); if (!proc) return { ok: false, erro: 'não foi possível ler a imagem (arquivo corrompido ou formato inválido)' }
      let bytes = proc.bytes
      if (!proc.reencodou) {
        const limpo = limpaMetadados(original, img.tipo); if (!limpo) return { ok: false, erro: 'o arquivo está corrompido (estrutura da imagem inválida)' }
        const novaImg = detectaImagem(limpo); if (!novaImg || novaImg.tipo !== img.tipo || novaImg.largura !== img.largura || novaImg.altura !== img.altura) return { ok: false, erro: 'o arquivo está corrompido (estrutura da imagem inválida)' }
        bytes = limpo
      }
      const removidos = Math.max(0, original.length - bytes.length), hash = createHash('sha256').update(bytes).digest('hex') // o id é o hash do que FICA: o mesmo retrato com e sem EXIF é a mesma imagem
      const variantesDe = async (h: string) => (await q(`SELECT largura FROM plataforma.ativo_variante WHERE tenant_id = $1 AND hash = $2 ORDER BY largura`, [tenantId, h])).rows.map((x) => Number(x.largura))
      const ja = (await q(`SELECT ${COLS} FROM plataforma.ativo WHERE tenant_id = $1 AND hash = $2`, [tenantId, hash])).rows[0]; if (ja) { // já existe: completa as versões que faltam (imagem enviada antes das versões existirem, ou envio interrompido no meio)
        for (const v of proc.variantes) await q(`INSERT INTO plataforma.ativo_variante (tenant_id, hash, largura, conteudo) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [tenantId, hash, v.largura, v.bytes])
        return { ok: true, ativo: linha(ja, await variantesDe(hash)), novo: false, removidos, ajustada: proc.reencodou }
      }
      const uso = (await q(`SELECT count(*)::int AS n, coalesce(sum(tamanho), 0)::bigint AS b FROM plataforma.ativo WHERE tenant_id = $1`, [tenantId])).rows[0]!
      if (Number(uso.n) >= lim.arquivosPorTenant) return { ok: false, erro: `limite de ${lim.arquivosPorTenant} imagens por loja` }
      const extra = bytes.length + proc.variantes.reduce((t, v) => t + v.bytes.length, 0)
      if (Number(uso.b) + extra > lim.bytesPorTenant) return { ok: false, erro: `limite de ${Math.round(lim.bytesPorTenant / 1048576)} MB de imagens por loja` }
      const r = (await q(`INSERT INTO plataforma.ativo (tenant_id, hash, nome, tipo, largura, altura, tamanho, conteudo, autor) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (tenant_id, hash) DO UPDATE SET nome = plataforma.ativo.nome RETURNING ${COLS}`, [tenantId, hash, nome, img.tipo, proc.largura, proc.altura, bytes.length, bytes, autor.slice(0, 200)])).rows[0]!
      for (const v of proc.variantes) await q(`INSERT INTO plataforma.ativo_variante (tenant_id, hash, largura, conteudo) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [tenantId, hash, v.largura, v.bytes])
      return { ok: true, ativo: linha(r, proc.variantes.map((v) => v.largura)), novo: true, removidos, ajustada: proc.reencodou }
    },
    async lista(tenantId: string): Promise<Ativo[]> {
      const rows = (await q(`SELECT ${COLS} FROM plataforma.ativo WHERE tenant_id = $1 ORDER BY criado_em DESC, hash LIMIT 500`, [tenantId])).rows
      const v = new Map<string, number[]>(); for (const x of (await q(`SELECT hash, largura FROM plataforma.ativo_variante WHERE tenant_id = $1 ORDER BY largura`, [tenantId])).rows) v.set(x.hash as string, [...(v.get(x.hash as string) ?? []), Number(x.largura)])
      return rows.map((r) => linha(r, v.get(r.hash as string) ?? []))
    },
    /** o conteúdo para servir; só do tenant dado */
    async le(tenantId: string, hash: string, largura?: number): Promise<{ tipo: TipoImagem; bytes: Buffer; hash: string } | null> {
      if (!/^[0-9a-f]{64}$/.test(hash)) return null
      if (largura !== undefined) { // a versão menor (sempre webp): só as larguras geradas
        if (!(LARGURAS_VARIANTES as readonly number[]).includes(largura)) return null
        const v = (await q(`SELECT conteudo FROM plataforma.ativo_variante WHERE tenant_id = $1 AND hash = $2 AND largura = $3`, [tenantId, hash, largura])).rows[0]; if (v) return { tipo: 'image/webp', bytes: Buffer.from(v.conteudo as Uint8Array), hash }
        const o = (await q(`SELECT tipo, conteudo FROM plataforma.ativo WHERE tenant_id = $1 AND hash = $2`, [tenantId, hash])).rows[0] // sem a versão (imagem menor que a largura, ou animada): o ORIGINAL, para o `srcset` automático nunca quebrar
        return o ? { tipo: o.tipo as TipoImagem, bytes: Buffer.from(o.conteudo as Uint8Array), hash } : null
      }
      const r = (await q(`SELECT tipo, conteudo FROM plataforma.ativo WHERE tenant_id = $1 AND hash = $2`, [tenantId, hash])).rows[0]; if (!r) return null
      return { tipo: r.tipo as TipoImagem, bytes: Buffer.from(r.conteudo as Uint8Array), hash }
    },
    async remove(tenantId: string, hash: string): Promise<boolean> { return /^[0-9a-f]{64}$/.test(hash) && (await q(`DELETE FROM plataforma.ativo WHERE tenant_id = $1 AND hash = $2`, [tenantId, hash])).rowCount > 0 },
  }
}
export type Ativos = ReturnType<typeof criaAtivos>
