import { montaFormularios } from './ilha'

// ENTRADA DO PACOTE DO NAVEGADOR (esbuild, IIFE `PolarisFormularios`): monta os formulários da página quando o runtime vivo terminou de hidratar
// (antes disso o DOM ainda é do servidor e seria refeito) e expõe `monta()` para o roteador chamar depois de trocar a página.
export { montaFormulario, montaFormularios } from './ilha'
const w = window as unknown as { __PL?: { montado: unknown } }
const monta = () => { void montaFormularios(document) }
export const inicia = monta
const espera = (tentativas = 40) => { if (w.__PL?.montado || tentativas <= 0) monta(); else setTimeout(() => espera(tentativas - 1), 50) } // até 2 s; sem runtime vivo na página, monta direto
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => espera()); else espera()
