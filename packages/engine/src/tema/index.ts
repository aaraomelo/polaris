import { emite, type No, type Registry } from '@polaris/schema'
import { BASE_CSS } from './base-css'
import { contraste } from './contraste'

export { BASE_CSS } from './base-css'
export { contraste, ehEscura, luminancia } from './contraste'

// ---------------------------------------------------------------------------
// Tokens SEMÂNTICOS do Polaris (cor.fundo, cor.texto…), não nomes de componente. Origem: o `ThemeConfig` do tiffany-erp (15 cores + geometria),
// que aqui vira um nó `kind: tema` comum: o mesmo schema, a mesma emissão (`emite(no, 'css')` → variáveis CSS e modos) e a mesma cascata por tenant.
// ---------------------------------------------------------------------------

/** O formato de tema do tiffany-erp (erp-app/src/theme/palettes.ts). */
export type ConfigTiffany = {
  presetId?: string
  primary: string; primaryHover: string; primaryLight: string; secondary: string; accent: string
  bg: string; surface: string; surfaceAlt: string; border: string; text: string; textMuted: string
  success: string; warn: string; danger: string; textOnPrimary: string
  radius: number; radiusLg: number; borderWidth: number
  /** rem × 100 (50 = 0,5 rem) */
  spacingBase: number
}

export const TOKENS_COR = ['primaria', 'primariaHover', 'primariaClara', 'secundaria', 'destaque', 'fundo', 'superficie', 'superficieAlt', 'borda', 'texto', 'textoSuave', 'sucesso', 'alerta', 'erro', 'textoSobrePrimaria'] as const
type Cores = Record<(typeof TOKENS_COR)[number], string>

const FAMILIA = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

const coresDe = (c: ConfigTiffany): Cores => ({
  primaria: c.primary, primariaHover: c.primaryHover, primariaClara: c.primaryLight, secundaria: c.secondary, destaque: c.accent,
  fundo: c.bg, superficie: c.surface, superficieAlt: c.surfaceAlt, borda: c.border, texto: c.text, textoSuave: c.textMuted,
  sucesso: c.success, alerta: c.warn, erro: c.danger, textoSobrePrimaria: c.textOnPrimary,
})

const num = (v: unknown, min: number, max: number, padrao: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : padrao)

/**
 * Converte o tema do Tiffany num nó `tema` do Polaris. `escuro` (opcional) é outra configuração do Tiffany cujas CORES viram o modo `escuro`
 * (a geometria é uma só). Valores fora de faixa são limitados como o DTO do Tiffany faz.
 */
export function temaDeConfig(id: string, config: ConfigTiffany, opcoes: { escuro?: ConfigTiffany; versao?: string } = {}): No {
  const spec: Record<string, unknown> = {
    tokens: {
      cor: coresDe(config),
      raio: { pequeno: num(config.radius, 0, 40, 6), grande: num(config.radiusLg, 0, 40, 8) },
      espacamento: { base: `${num(config.spacingBase, 20, 200, 50) / 100}rem`, borda: num(config.borderWidth, 0, 6, 1) },
      tipografia: { familia: FAMILIA, tamanhoBase: '16px' },
    },
  }
  if (opcoes.escuro) spec.modos = { escuro: { cor: coresDe(opcoes.escuro) } }
  return { kind: 'tema', id, versao: opcoes.versao ?? '1.0.0', estatuto: 'publicado', spec } as unknown as No
}

const base = { radius: 6, radiusLg: 8, borderWidth: 1, spacingBase: 50 }
/** As paletas do tiffany-erp (palettes.ts), copiadas como DADO. */
export const PRESETS_TIFFANY: Record<string, ConfigTiffany> = {
  'patria-blue': { ...base, presetId: 'patria-blue', primary: '#1F4E79', primaryHover: '#173a5b', primaryLight: '#e8eff7', secondary: '#0277bd', accent: '#ff9800', bg: '#fafbfc', surface: '#ffffff', surfaceAlt: '#f6f8fa', border: '#e5e9ee', text: '#222222', textMuted: '#666666', success: '#2E7D32', warn: '#B45309', danger: '#c0392b', textOnPrimary: '#ffffff' },
  'nco-red': { ...base, presetId: 'nco-red', primary: '#cc1144', primaryHover: '#a30e36', primaryLight: '#fde8ee', secondary: '#161b27', accent: '#f59e0b', bg: '#0c1019', surface: '#161b27', surfaceAlt: '#1d2330', border: '#2a3142', text: '#e6e8f0', textMuted: '#8a91a8', success: '#22c55e', warn: '#f59e0b', danger: '#ef4444', textOnPrimary: '#ffffff' },
  graphite: { ...base, presetId: 'graphite', primary: '#37474f', primaryHover: '#263238', primaryLight: '#eceff1', secondary: '#546e7a', accent: '#26a69a', bg: '#f4f5f7', surface: '#ffffff', surfaceAlt: '#eef0f3', border: '#d7dbe0', text: '#222222', textMuted: '#5b6066', success: '#2E7D32', warn: '#B45309', danger: '#c0392b', textOnPrimary: '#ffffff' },
}

/** Paleta GRAFITE (a escolhida no estudo de paleta): neutros quentes, primária de cinza-azulado e laranja de acento. Todos os pares de texto passam AA (4,5:1) e o anel de foco passa 3:1, nos dois modos (ver `auditaTema` e o teste). */
const GRAFITE_CLARO: ConfigTiffany = {
  ...base, presetId: 'grafite', primary: '#2D3A4F', primaryHover: '#1F2A3B', primaryLight: '#E6E9EF', secondary: '#6B4FBB', accent: '#D9580B',
  bg: '#F6F6F5', surface: '#FFFFFF', surfaceAlt: '#EEEEEC', border: '#DAD9D5', text: '#1C1C1A', textMuted: '#5C5C57',
  success: '#1B7243', warn: '#8F5300', danger: '#B3261E', textOnPrimary: '#FFFFFF',
}
/** Modo escuro do tema padrão (Grafite). */
const ESCURO_PADRAO: ConfigTiffany = {
  ...base, presetId: 'grafite-escuro', primary: '#B8C6E0', primaryHover: '#D0DBEE', primaryLight: '#252C39', secondary: '#B7A3F0', accent: '#FF9A4D',
  bg: '#101011', surface: '#18181A', surfaceAlt: '#212124', border: '#303034', text: '#ECECEA', textMuted: '#A0A09A',
  success: '#62CE8D', warn: '#F2B25C', danger: '#FF8F86', textOnPrimary: '#0C0F16',
}

/** Tema do core: Grafite claro + modo `escuro`. Um tenant o substitui registrando um `tema` com o mesmo id no seu escopo. */
export const TEMA_PADRAO: No = temaDeConfig('padrao', GRAFITE_CLARO, { escuro: ESCURO_PADRAO })

/** Registra o tema padrão e os presets do Tiffany (`tema.<preset>`) no core. */
export function registraTemas(reg: Registry): void {
  reg.registra(structuredClone(TEMA_PADRAO))
  for (const [nome, cfg] of Object.entries(PRESETS_TIFFANY)) reg.registra(temaDeConfig(nome, cfg))
}

/** CSS completo de uma página: variáveis do tema (+ modos) e a folha dos blocos. Determinístico (ordem estável). */
export const cssDoTema = (no: No): string => `${emite(no, 'css')}\n${BASE_CSS}`

// ---- auditoria de acessibilidade ------------------------------------------------------------------------------------------------------

export type AvisoTema = { modo: string; par: string; contraste: number; minimo: number }
const PARES: Array<[string, string, number, string]> = [
  // [texto, fundo, mínimo, rótulo]. 4,5 = AA para texto; 3 = AA para componentes de UI
  ['texto', 'fundo', 4.5, 'texto/fundo'], ['texto', 'superficie', 4.5, 'texto/superfície'], ['texto', 'superficieAlt', 4.5, 'texto/superfície alternativa'],
  ['textoSuave', 'superficie', 4.5, 'texto suave/superfície'], ['textoSuave', 'fundo', 4.5, 'texto suave/fundo'],
  ['textoSobrePrimaria', 'primaria', 4.5, 'texto sobre primária/primária'], ['textoSobrePrimaria', 'primariaHover', 4.5, 'texto sobre primária/hover'],
  ['primaria', 'fundo', 3, 'primária/fundo (UI)'], ['primaria', 'superficie', 4.5, 'link (primária)/superfície'],
  ['sucesso', 'superficie', 4.5, 'selo sucesso/superfície'], ['alerta', 'superficie', 4.5, 'selo alerta/superfície'], ['erro', 'superficie', 4.5, 'selo erro/superfície'],
  ['borda', 'fundo', 1.1, 'borda/fundo (existe)'],
]

/** Confere os pares de cor críticos (AA) em cada modo do tema. Devolve só o que NÃO passa. */
export function auditaTema(no: No): AvisoTema[] {
  const spec = no.spec as { tokens: { cor?: Record<string, string> }; modos?: Record<string, { cor?: Record<string, string> }> }
  const modos: Array<[string, Record<string, string>]> = [['claro', spec.tokens.cor ?? {}]]
  for (const [m, v] of Object.entries(spec.modos ?? {})) modos.push([m, { ...(spec.tokens.cor ?? {}), ...(v.cor ?? {}) }])
  const out: AvisoTema[] = []
  for (const [modo, cor] of modos) {
    for (const [a, b, minimo, par] of PARES) {
      if (!cor[a] || !cor[b]) { out.push({ modo, par: `${par} (token ausente)`, contraste: 0, minimo }); continue }
      const c = contraste(cor[a]!, cor[b]!)
      if (c < minimo) out.push({ modo, par, contraste: Math.round(c * 100) / 100, minimo })
    }
  }
  return out
}

/** Os nomes `--x` usados na folha base: o tema precisa declarar todos (conferido em teste). */
export const variaveisDaBase = (): string[] => {
  const proprias = new Set([...BASE_CSS.matchAll(/[{;](--[a-z0-9-]+):/g)].map((m) => m[1]!)) // as que a própria folha declara (as imagens dos ícones), não são do tema
  return [...new Set([...BASE_CSS.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]!))].filter((v) => !proprias.has(v)).sort()
}
