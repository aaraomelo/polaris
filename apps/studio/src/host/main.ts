import { montaVivo, type Programa } from '@polaris/engine'
import '@polaris/engine/formulario' // registra o validador na função `validaFormulario` (o painel de teste do editor de formulários)
import { criaCarregador, fonteDe } from './api'

// O hospedeiro: carrega o PROGRAMA da página `studio.app` (compilado em build a partir dos nós JSON), resolve os dados `auto` e monta a página com o runtime vivo da plataforma.
async function inicia(): Promise<void> {
  const raiz = document.getElementById('polaris')!
  try {
    const programa = (await (await fetch('/studio/ativos/studio.programa.json', { credentials: 'same-origin' })).json()) as Programa
    const carregador = criaCarregador(programa as never)
    const dados: Record<string, unknown> = {}, status: Record<string, 'ok' | 'erro'> = {}, erros: Record<string, string> = {}
    await Promise.all(Object.keys(programa.pagina.dados).filter((nome) => fonteDe(programa as never, nome)?.carregar === 'auto').map(async (nome) => {
      try { dados[nome] = await carregador({ dados: nome, args: {}, estado: {} }); status[nome] = 'ok' } catch (e) { status[nome] = 'erro'; erros[nome] = (e as Error).message }
    }))
    montaVivo({ programa, container: raiz, carregador, dados, status, erros, onErro: (e) => console.error('[studio]', e.mensagem) })
    document.title = 'Polaris Studio'
  } catch (e) { raiz.textContent = `Não foi possível iniciar o Studio: ${(e as Error).message}` }
}
// no celular a lateral fica atrás do botão (caixa de marcar do `nav/alternador`, sem JS): escolher um item a recolhe (o roteador do site faz o mesmo nas páginas do tenant; o Studio não carrega o roteador)
document.addEventListener('click', (e) => {
  const alvo = e.target as Element | null, lateral = alvo?.closest?.('aside[data-lateral]'); if (!lateral || !alvo!.closest('button, a[href]')) return
  const caixa = lateral.querySelector<HTMLInputElement>(':scope > input[data-alternador]'); if (caixa) caixa.checked = false
})
void inicia()
