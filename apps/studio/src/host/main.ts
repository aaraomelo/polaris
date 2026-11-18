import { montaVivo, type Programa } from '@polaris/engine'
import { criaCarregador, fonteDe } from './api'

// O hospedeiro: carrega o PROGRAMA da página `studio.app` (compilado em build a partir dos nós JSON), resolve os dados `auto` e monta a página com o runtime vivo da plataforma.
async function inicia(): Promise<void> {
  const raiz = document.getElementById('studio')!
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
void inicia()
