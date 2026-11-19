import { createHash } from 'node:crypto'

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
`

export type TipoImagem = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
export const EXTENSAO: Record<TipoImagem, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
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

export type Ativo = { id: string; nome: string; tipo: TipoImagem; largura: number; altura: number; tamanho: number; criadoEm: string; autor: string; caminho: string }
export type ResultadoAtivo = { ok: true; ativo: Ativo; novo: boolean } | { ok: false; erro: string }
type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>
export const caminhoDoAtivo = (hash: string, tipo: TipoImagem) => `/_polaris/img/${hash}.${EXTENSAO[tipo]}`
const NOME = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/g
const linha = (r: Record<string, unknown>): Ativo => ({ id: r.hash as string, nome: r.nome as string, tipo: r.tipo as TipoImagem, largura: Number(r.largura), altura: Number(r.altura), tamanho: Number(r.tamanho), criadoEm: new Date(r.criado_em as string).toISOString(), autor: r.autor as string, caminho: caminhoDoAtivo(r.hash as string, r.tipo as TipoImagem) })
const COLS = 'hash, nome, tipo, largura, altura, tamanho, autor, criado_em'

export function criaAtivos(o: { q: Q; limites?: Partial<typeof LIMITES_ATIVOS> }) {
  const lim = { ...LIMITES_ATIVOS, ...o.limites }, q = o.q
  return {
    /** `dados` em base64 (o Studio fala JSON); idempotente: o mesmo conteúdo no mesmo tenant devolve o ativo que já existe */
    async salva(tenantId: string, autor: string, e: { nome: string; dados: string }): Promise<ResultadoAtivo> {
      const nome = String(e.nome ?? '').replace(NOME, ' ').trim().slice(0, 120); if (!nome) return { ok: false, erro: 'dê um nome ao arquivo' }
      if (typeof e.dados !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(e.dados)) return { ok: false, erro: 'os dados do arquivo não são base64 válido' }
      if (e.dados.length > Math.ceil((lim.bytesPorArquivo * 4) / 3) + 8) return { ok: false, erro: `o arquivo passa de ${Math.round(lim.bytesPorArquivo / 1024)} KB` }
      const bytes = Buffer.from(e.dados, 'base64'); if (!bytes.length || bytes.length > lim.bytesPorArquivo) return { ok: false, erro: `o arquivo precisa ter de 1 byte a ${Math.round(lim.bytesPorArquivo / 1024)} KB` }
      const img = detectaImagem(bytes); if (!img) return { ok: false, erro: 'só imagens png, jpeg, gif ou webp (o tipo é lido do próprio arquivo)' }
      if (img.largura < 1 || img.altura < 1 || img.largura > lim.ladoMax || img.altura > lim.ladoMax || img.largura * img.altura > lim.megapixelsMax * 1_000_000) return { ok: false, erro: `dimensões fora do limite (${img.largura}×${img.altura}; máximo ${lim.ladoMax} px de lado e ${lim.megapixelsMax} megapixels)` }
      const hash = createHash('sha256').update(bytes).digest('hex')
      const ja = (await q(`SELECT ${COLS} FROM plataforma.ativo WHERE tenant_id = $1 AND hash = $2`, [tenantId, hash])).rows[0]; if (ja) return { ok: true, ativo: linha(ja), novo: false }
      const uso = (await q(`SELECT count(*)::int AS n, coalesce(sum(tamanho), 0)::bigint AS b FROM plataforma.ativo WHERE tenant_id = $1`, [tenantId])).rows[0]!
      if (Number(uso.n) >= lim.arquivosPorTenant) return { ok: false, erro: `limite de ${lim.arquivosPorTenant} imagens por loja` }
      if (Number(uso.b) + bytes.length > lim.bytesPorTenant) return { ok: false, erro: `limite de ${Math.round(lim.bytesPorTenant / 1048576)} MB de imagens por loja` }
      const r = (await q(`INSERT INTO plataforma.ativo (tenant_id, hash, nome, tipo, largura, altura, tamanho, conteudo, autor) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (tenant_id, hash) DO UPDATE SET nome = plataforma.ativo.nome RETURNING ${COLS}`, [tenantId, hash, nome, img.tipo, img.largura, img.altura, bytes.length, bytes, autor.slice(0, 200)])).rows[0]!
      return { ok: true, ativo: linha(r), novo: true }
    },
    async lista(tenantId: string): Promise<Ativo[]> { return (await q(`SELECT ${COLS} FROM plataforma.ativo WHERE tenant_id = $1 ORDER BY criado_em DESC, hash LIMIT 500`, [tenantId])).rows.map(linha) },
    /** o conteúdo para servir; só do tenant dado */
    async le(tenantId: string, hash: string): Promise<{ tipo: TipoImagem; bytes: Buffer; hash: string } | null> {
      if (!/^[0-9a-f]{64}$/.test(hash)) return null
      const r = (await q(`SELECT tipo, conteudo FROM plataforma.ativo WHERE tenant_id = $1 AND hash = $2`, [tenantId, hash])).rows[0]; if (!r) return null
      return { tipo: r.tipo as TipoImagem, bytes: Buffer.from(r.conteudo as Uint8Array), hash }
    },
    async remove(tenantId: string, hash: string): Promise<boolean> { return /^[0-9a-f]{64}$/.test(hash) && (await q(`DELETE FROM plataforma.ativo WHERE tenant_id = $1 AND hash = $2`, [tenantId, hash])).rowCount > 0 },
  }
}
export type Ativos = ReturnType<typeof criaAtivos>
