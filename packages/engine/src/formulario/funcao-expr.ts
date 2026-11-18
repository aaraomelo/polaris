import { defineValidadorDeFormulario } from '../expr/formulario-gancho'
import { validaValores, type FormularioSpec } from './validador'

/** registra o validador do formulário na função `validaFormulario` da linguagem (o Studio testa uma definição com valores de exemplo) */
defineValidadorDeFormulario((spec, valores, idioma) => {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec) || !Array.isArray((spec as { campos?: unknown }).campos) || !valores || typeof valores !== 'object' || Array.isArray(valores)) return undefined
  try {
    const r = validaValores(spec as FormularioSpec, valores as Record<string, unknown>, typeof idioma === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(idioma) ? { idioma } : {})
    return { ok: r.ok, erros: r.erros, valores: r.valores }
  } catch { return undefined }
})
