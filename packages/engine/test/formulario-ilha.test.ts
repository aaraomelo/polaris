// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { montaFormulario, montaFormularios, posicaoDoCursor, mascaraDoCampo, type Ilha, type OpcoesIlha } from '../src/formulario/ilha'

const exemplo = (n: string) => (JSON.parse(readFileSync(join(import.meta.dirname, '../../schema/test/exemplos/validos', n), 'utf8')) as { spec: any }).spec
const contato = exemplo('formulario-contato.json'), passos = exemplo('formulario-passos.json')
let n = 0
type Env = { ilha: Ilha; el: HTMLElement; envios: Array<{ id: string; corpo: any; chave: string }>; navs: string[]; eventos: Array<{ tipo: string; detail: any }> }
async function monta(spec: any, o: Partial<OpcoesIlha> & { resposta?: (c: any) => { status: number; corpo: unknown }; atraso?: Promise<void>; atributos?: Record<string, string> } = {}): Promise<Env> {
  const el = document.createElement('div'); el.setAttribute('data-polaris-formulario', `f${++n}`); for (const [k, v] of Object.entries(o.atributos ?? {})) el.setAttribute(k, v); document.body.appendChild(el)
  const envios: Env['envios'] = [], navs: string[] = [], eventos: Env['eventos'] = []
  for (const t of ['polaris-enviado', 'polaris-erro']) el.addEventListener(t, (e) => eventos.push({ tipo: t, detail: (e as CustomEvent).detail }))
  const ilha = await montaFormulario(el, { busca: async () => ({ spec }), envia: async (id, corpo, chave) => { envios.push({ id, corpo, chave }); if (o.atraso) await o.atraso; return (o.resposta ?? (() => ({ status: 200, corpo: { ok: true, resultado: { id: 1 }, sucesso: { mensagem: 'Enviado!', limpar: false, acoes: [] } } })))(corpo) }, navega: (p) => navs.push(p), hoje: () => '2026-06-15', ...o })
  return { ilha: ilha!, el, envios, navs, eventos }
}
afterEach(() => { document.body.textContent = '' })
const campo = (e: Env, nome: string) => e.el.querySelector<HTMLElement>(`[data-campo="${nome}"]`)!
const ent = (e: Env, nome: string) => campo(e, nome).querySelector<HTMLInputElement>('input,select,textarea')!
const digita = (i: HTMLInputElement | HTMLTextAreaElement, v: string) => { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })) }
const sai = (i: HTMLElement) => i.dispatchEvent(new Event('blur', { bubbles: true }))
const erroDe = (e: Env, nome: string) => { const x = campo(e, nome).querySelector<HTMLElement>('.pl-erro')!; return x.hidden ? '' : x.textContent }
const envia = (e: Env) => { e.el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); return new Promise((r) => setTimeout(r, 0)) }
const preenche = (e: Env, v: Record<string, string>) => { for (const [k, x] of Object.entries(v)) digita(ent(e, k), x) }
const VALIDO = { nome: 'Ana Maria', email: 'ana@exemplo.com', mensagem: 'Gostaria de saber o prazo.' }
const marca = (e: Env, nome: string, v = true) => { const i = ent(e, nome); i.checked = v; i.dispatchEvent(new Event('change', { bubbles: true })) }
const escolhe = (e: Env, nome: string, v: string) => { const s = ent(e, nome) as unknown as HTMLSelectElement; s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })) }

describe('ilha: montagem e acessibilidade', () => {
  it('desenha os campos do formulário, com rótulo ligado, ajuda/erro descritos e obrigatórios marcados', async () => {
    const e = await monta(contato)
    expect(e.el.querySelector('h2')!.textContent).toBe('Fale conosco'); expect(e.el.getAttribute('aria-busy')).toBe('false')
    const nome = ent(e, 'nome'); const lab = campo(e, 'nome').querySelector('label')!
    expect(lab.getAttribute('for')).toBe(nome.id); expect(lab.textContent).toBe('Nome completo'); expect(nome.getAttribute('aria-required')).toBe('true'); expect(nome.getAttribute('autocomplete')).toBe('name')
    expect(nome.getAttribute('aria-describedby')).toContain(`${nome.id.replace('-c', '')}-erro`)
    expect((ent(e, 'email') as HTMLInputElement).type).toBe('email'); expect(ent(e, 'mensagem').tagName).toBe('TEXTAREA'); expect(ent(e, 'assunto').tagName).toBe('SELECT')
    expect(ent(e, 'aceite').getAttribute('type')).toBe('checkbox'); expect([...ent(e, 'assunto').querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Selecione…', 'Dúvida', 'Sobre um pedido', 'Outro assunto'])
    expect(e.el.querySelectorAll('fieldset.pl-secao').length).toBe(3); expect(e.el.querySelector('legend')!.textContent).toBe('Quem é você')
  })
  it('idioma: rótulos e opções em inglês quando o pedido é em inglês', async () => {
    const e = await monta(contato, { idioma: 'en' }); expect([...ent(e, 'assunto').querySelectorAll('option')].map((o) => o.textContent)).toContain('Something else'); expect(e.el.querySelector('.pl-acoes button[data-acao=enviar]')!.textContent).toBe('Enviar mensagem')
  })
  it('definição que não carrega: mensagem no lugar, sem lançar; id vazio ou montado duas vezes não faz nada', async () => {
    const el = document.createElement('div'); el.setAttribute('data-polaris-formulario', 'x'); document.body.appendChild(el)
    expect(await montaFormulario(el, { busca: async () => { throw new Error('404') } })).toBeNull(); expect(el.textContent).toBe('Não foi possível carregar o formulário.')
    const e = await monta(contato); expect(await montaFormulario(e.el, { busca: async () => ({ spec: contato }) })).toBeNull()
    const sem = document.createElement('div'); expect(await montaFormulario(sem)).toBeNull()
  })
  it('montaFormularios acha os pontos de montagem pendentes', async () => {
    document.body.innerHTML = '<div data-polaris-formulario="a"></div><div data-polaris-formulario="b"></div>'
    const r = await montaFormularios(document, { busca: async () => ({ spec: { campos: [{ nome: 'x', tipo: 'texto' }] } as never }) }); expect(r.length).toBe(2); expect((await montaFormularios(document, { busca: async () => ({ spec: contato }) })).length).toBe(0)
  })
  it('valores iniciais do atributo (edição) entram nos campos; JSON ruim é ignorado', async () => {
    const e = await monta(contato, { atributos: { 'data-polaris-valores': JSON.stringify({ nome: 'Beto', aceite: true, assunto: 'duvida' }) } }); expect(ent(e, 'nome').value).toBe('Beto'); expect(ent(e, 'aceite').checked).toBe(true); expect((ent(e, 'assunto') as unknown as HTMLSelectElement).value).toBe('duvida')
    const r = await monta(contato, { atributos: { 'data-polaris-valores': '{ruim' } }); expect(ent(r, 'nome').value).toBe('')
  })
})

describe('ilha: máscaras na digitação', () => {
  it('telefone troca de 10 para 11 dígitos; o cursor fica depois do que foi digitado', async () => {
    const e = await monta(contato), t = ent(e, 'telefone')
    digita(t, '1122223333'); expect(t.value).toBe('(11) 2222-3333'); digita(t, '11922223333'); expect(t.value).toBe('(11) 92222-3333'); digita(t, '(11) 92222-3333x9'); expect(t.value).toBe('(11) 92222-3333')
    digita(t, '11'); expect(t.value).toBe('(11'); expect(posicaoDoCursor('(11) 92222-3333', 2)).toBe(3); expect(posicaoDoCursor('(11) 92222-3333', 3)).toBe(6); expect(posicaoDoCursor('(11) 92222-3333', 4)).toBe(7); expect(posicaoDoCursor('(11) 9', 0)).toBe(0); expect(posicaoDoCursor('(11', 99)).toBe(3)
  })
  it('máscara padrão do tipo (CPF sem declarar), máscara de pedido em maiúsculas, colar formatado', async () => {
    const e = await monta(contato); marca(e, 'retorno'); const cpf = ent(e, 'cpf'); digita(cpf, '52998224725'); expect(cpf.value).toBe('529.982.247-25'); digita(cpf, 'CPF 529.982.247-25'); expect(cpf.value).toBe('529.982.247-25')
    escolhe(e, 'assunto', 'pedido'); const p = ent(e, 'pedido'); digita(p, 'abc123456'); expect(p.value).toBe('ABC-123456')
    expect(mascaraDoCampo({ nome: 'd', tipo: 'data' })).toEqual({ padrao: '00/00/0000' }); expect(mascaraDoCampo({ nome: 'd', tipo: 'data', formato: { formatoData: 'yyyy-MM-dd' } })).toEqual({ padrao: '0000-00-00' }); expect(mascaraDoCampo({ nome: 'x', tipo: 'texto' })).toBeUndefined()
    const d = ent(e, 'dataCompra'); digita(d, '10032026'); expect(d.value).toBe('10/03/2026')
  })
  it('senha não tem máscara; dinheiro é formatado ao sair do campo', async () => {
    const e = await monta(passos); const s = ent(e, 'senha'); digita(s, 'abc12345'); expect(s.value).toBe('abc12345'); expect(s.getAttribute('autocomplete')).toBe('new-password')
    const c = await monta(contato), v = ent(c, 'valorCompra'); digita(v, '1234,5'); sai(v); expect(v.value).toBe('1.234,50')
  })
})

describe('ilha: validação e estado dos campos', () => {
  it('erro aparece ao SAIR do campo (padrão), com a mensagem do autor, aria-invalid e desaparece ao corrigir', async () => {
    const e = await monta(contato), nome = ent(e, 'nome')
    expect(erroDe(e, 'nome')).toBe(''); sai(nome); expect(erroDe(e, 'nome')).toBe('Diga como podemos chamar você.'); expect(nome.getAttribute('aria-invalid')).toBe('true')
    digita(nome, 'Al'); expect(erroDe(e, 'nome')).toBe('O nome precisa de pelo menos 3 letras.'); digita(nome, 'Ana'); expect(erroDe(e, 'nome')).toBe(''); expect(nome.hasAttribute('aria-invalid')).toBe(false)
    expect(erroDe(e, 'email')).toBe('') // outro campo ainda não tocado
  })
  it('campos condicionais aparecem e somem conforme as respostas', async () => {
    const e = await monta(contato)
    expect(campo(e, 'cpf').hidden).toBe(true); expect(campo(e, 'pedido').hidden).toBe(true)
    marca(e, 'retorno'); expect(campo(e, 'cpf').hidden).toBe(false); escolhe(e, 'assunto', 'pedido'); expect(campo(e, 'pedido').hidden).toBe(false)
    marca(e, 'retorno', false); expect(campo(e, 'cpf').hidden).toBe(true)
  })
  it('validar.quando = alterar mostra o erro a cada tecla; mostrarTodos mostra todos os erros do campo', async () => {
    const e = await monta({ validar: { quando: 'alterar', mostrarTodos: true }, campos: [{ nome: 'c', tipo: 'texto', rotulo: 'C', validacao: { tamanhoMinimo: 5, padrao: '[0-9]+' } }] }); digita(ent(e, 'c'), 'ab'); expect(erroDe(e, 'c')).toBe('C deve ter pelo menos 5 caracteres. C está em um formato inválido.')
  })
  it('XSS: rótulos e mensagens do autor viram TEXTO, nunca HTML', async () => {
    const e = await monta({ titulo: '<img src=x onerror=alert(1)>', campos: [{ nome: 'a', tipo: 'texto', rotulo: '<b>Nome</b>', obrigatorio: true, ajuda: '<script>1</script>', mensagens: { obrigatorio: '<i>falta</i>' } }] })
    expect(e.el.querySelector('img,script,b,i')).toBeNull(); expect(e.el.querySelector('h2')!.textContent).toBe('<img src=x onerror=alert(1)>'); sai(ent(e, 'a')); expect(erroDe(e, 'a')).toBe('<i>falta</i>')
  })
})

describe('ilha: envio', () => {
  it('inválido: não envia, mostra todos os erros, foca o primeiro campo com erro e avisa com polaris-erro', async () => {
    const e = await monta(contato); await envia(e)
    expect(e.envios.length).toBe(0); expect(erroDe(e, 'nome')).toBe('Diga como podemos chamar você.'); expect(erroDe(e, 'email')).toBe('E-mail é obrigatório.'); expect(erroDe(e, 'aceite')).toBe('Precisamos do seu aceite para responder.')
    expect(document.activeElement).toBe(ent(e, 'nome')); expect(e.eventos[0]).toMatchObject({ tipo: 'polaris-erro' })
  })
  it('válido: envia os valores como estão na tela, com chave de idempotência; mostra a mensagem, avisa a página e segue as ações seguras', async () => {
    const e = await monta(contato, { resposta: () => ({ status: 200, corpo: { ok: true, resultado: { id: 7 }, sucesso: { mensagem: 'Recebemos sua mensagem.', limpar: true, acoes: [{ acao: 'navegar', para: '/obrigado' }, { acao: 'navegar', para: 'https://mau.com' }, { acao: 'navegar', para: '//mau.com' }, { acao: 'navegar', para: '/ok\\x' }] } } }) })
    preenche(e, VALIDO); marca(e, 'aceite'); escolhe(e, 'assunto', 'duvida'); digita(ent(e, 'telefone'), '11922223333'); await envia(e)
    expect(e.envios.length).toBe(1); expect(e.envios[0]!.corpo.valores).toMatchObject({ nome: 'Ana Maria', email: 'ana@exemplo.com', telefone: '(11) 92222-3333', assunto: 'duvida', aceite: true }); expect(e.envios[0]!.chave).toMatch(/^[0-9a-f]{32}$/)
    expect(e.el.querySelector<HTMLElement>('.pl-status')!.textContent).toBe('Recebemos sua mensagem.'); expect(e.eventos.at(-1)).toMatchObject({ tipo: 'polaris-enviado', detail: { resultado: { id: 7 } } })
    expect(e.navs).toEqual(['/obrigado']) // só caminho do próprio site; externo, `//` e barra invertida são ignorados
    expect(ent(e, 'nome').value).toBe('') // limpar: true
  })
  it('a chave de idempotência é a mesma na retentativa e muda quando o visitante altera um valor', async () => {
    let resp = { status: 502, corpo: { erro: { mensagem: 'Falhou.' } } as unknown }; const e = await monta(contato, { resposta: () => resp })
    preenche(e, VALIDO); marca(e, 'aceite'); escolhe(e, 'assunto', 'duvida'); await envia(e); await envia(e); expect(e.envios[0]!.chave).toBe(e.envios[1]!.chave)
    digita(ent(e, 'nome'), 'Ana Maria Souza'); resp = { status: 200, corpo: { ok: true } }; await envia(e); expect(e.envios[2]!.chave).not.toBe(e.envios[1]!.chave)
  })
  it('duplo clique: o segundo envio é ignorado e os botões ficam desabilitados enquanto espera', async () => {
    let solta!: () => void; const e = await monta(contato, { atraso: new Promise<void>((r) => { solta = r }) })
    preenche(e, VALIDO); marca(e, 'aceite'); escolhe(e, 'assunto', 'duvida'); void envia(e); await envia(e)
    expect(e.envios.length).toBe(1); expect(e.el.querySelector<HTMLButtonElement>('button[data-acao=enviar]')!.disabled).toBe(true); expect(e.el.querySelector('form')!.getAttribute('aria-busy')).toBe('true')
    solta(); await new Promise((r) => setTimeout(r, 0)); expect(e.el.querySelector<HTMLButtonElement>('button[data-acao=enviar]')!.disabled).toBe(false)
  })
  it('422 do servidor: o erro vai para o campo certo (também de lista), foca e avisa; 5xx e falha de rede mostram a mensagem sem quebrar', async () => {
    const e = await monta(contato, { resposta: () => ({ status: 422, corpo: { erro: { codigo: 'formulario_invalido', mensagem: 'Corrija.' }, erros: [{ campo: 'email', regra: 'servico', mensagem: 'E-mail já cadastrado.' }, { campo: '_formulario', regra: 'x', mensagem: 'Algo geral.' }] } }) })
    preenche(e, VALIDO); marca(e, 'aceite'); escolhe(e, 'assunto', 'duvida'); await envia(e)
    expect(erroDe(e, 'email')).toBe('E-mail já cadastrado.'); expect(e.el.querySelector<HTMLElement>('form > .pl-erro')!.textContent).toBe('Algo geral.'); expect(document.activeElement).toBe(ent(e, 'email')); expect(e.eventos.at(-1)!.tipo).toBe('polaris-erro')
    const f = await monta(contato, { resposta: () => ({ status: 502, corpo: null }) }); preenche(f, VALIDO); marca(f, 'aceite'); escolhe(f, 'assunto', 'duvida'); await envia(f)
    expect(f.el.querySelector<HTMLElement>('form > .pl-erro')!.textContent).toBe('Não foi possível enviar agora. Tente de novo em instantes.'); expect(f.el.querySelector<HTMLElement>('form > .pl-erro')!.hidden).toBe(false)
    const g = await monta(contato, { resposta: () => { throw new Error('rede') } }); preenche(g, VALIDO); marca(g, 'aceite'); escolhe(g, 'assunto', 'duvida'); await envia(g); expect(g.el.querySelector<HTMLElement>('form > .pl-erro')!.hidden).toBe(false); expect(g.eventos.at(-1)).toMatchObject({ detail: { status: 0 } })
  })
  it('formulário sem envio: valida e avisa com os valores normalizados', async () => {
    const e = await monta({ campos: [{ nome: 'a', tipo: 'texto', obrigatorio: true }], acoes: [{ id: 'ok', rotulo: 'OK', tipo: 'enviar' }] }); digita(ent(e, 'a'), '  oi '); await envia(e); expect(e.eventos.at(-1)).toMatchObject({ tipo: 'polaris-enviado', detail: { valores: { a: 'oi' } } })
  })
})

describe('ilha: ações, passos e listas', () => {
  it('limpar com confirmação: pede antes, só apaga se confirmar; cancelar executa as ações seguras', async () => {
    const e = await monta(contato); digita(ent(e, 'nome'), 'Ana'); const limpar = e.el.querySelector<HTMLButtonElement>('button[data-acao=limpar]')!
    limpar.click(); expect(e.el.querySelector('.pl-confirma')!.textContent).toContain('Apagar tudo o que você digitou?'); const [ok, nao] = [...e.el.querySelectorAll<HTMLButtonElement>('.pl-confirma button')]
    expect(ok!.textContent).toBe('Apagar'); nao!.click(); expect(ent(e, 'nome').value).toBe('Ana'); expect(e.el.querySelector('.pl-confirma')).toBeNull()
    limpar.click(); e.el.querySelector<HTMLButtonElement>('.pl-confirma button')!.click(); expect(ent(e, 'nome').value).toBe('')
    e.el.querySelector<HTMLButtonElement>('button[data-acao=cancelar]')!.click(); expect(e.navs).toEqual(['/'])
  })
  it('passos: só o passo atual aparece; avançar valida o passo; voltar mantém os valores; enviar só no último', async () => {
    const e = await monta(passos), vis = (nome: string) => !campo(e, nome).closest<HTMLElement>('[hidden]') && !campo(e, nome).hidden
    const btn = (a: string) => e.el.querySelector<HTMLButtonElement>(`button[data-acao=${a}]`)!
    expect([vis('nome'), vis('cnpj')]).toEqual([true, false]); expect(btn('voltar').hidden).toBe(true); expect(btn('enviar').hidden).toBe(true); expect(e.el.querySelector('.pl-passos [aria-current=step]')!.textContent).toBe('Acesso')
    btn('avancar').click(); expect(e.ilha.passo()).toBe(0); expect(erroDe(e, 'nome')).toBe('Nome é obrigatório.'); expect(erroDe(e, 'senha')).toBe('Senha é obrigatório.')
    preenche(e, { nome: 'Empresa', senha: 'abc12345', confirma: 'diferente' }); btn('avancar').click(); expect(e.ilha.passo()).toBe(0); expect(erroDe(e, 'confirma')).toBe('As senhas não conferem.')
    digita(ent(e, 'confirma'), 'abc12345'); btn('avancar').click(); expect(e.ilha.passo()).toBe(1); expect([vis('nome'), vis('cnpj')]).toEqual([false, true]); expect(btn('enviar').hidden).toBe(false); expect(btn('avancar').hidden).toBe(true)
    btn('voltar').click(); expect(ent(e, 'nome').value).toBe('Empresa'); expect(e.ilha.passo()).toBe(0)
  })
  it('lista: começa com o mínimo de itens, adiciona e remove (caminhos renumerados), erros por item nos campos certos', async () => {
    const e = await monta(passos); const btn = (a: string) => e.el.querySelector<HTMLButtonElement>(`button[data-acao=${a}]`)!
    preenche(e, { nome: 'E', senha: 'abc12345', confirma: 'abc12345' }); btn('avancar').click()
    expect(e.el.querySelectorAll('.pl-item').length).toBe(1); const add = [...e.el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Adicionar')!
    add.click(); add.click(); expect(e.el.querySelectorAll('.pl-item').length).toBe(3)
    const rua = (i: number) => campo(e, `enderecos.${i}.rua`).querySelector('input')!
    digita(rua(0), 'Rua Zero'); digita(rua(1), 'Rua Um'); /* rua(2) fica vazia */
    e.el.querySelector<HTMLButtonElement>('.pl-item[data-item="0"] button')!.click() // remove o primeiro: os outros viram 0 e 1
    expect(e.el.querySelectorAll('.pl-item').length).toBe(2); expect(rua(0).value).toBe('Rua Um'); expect(rua(1).value).toBe(''); expect(campo(e, 'enderecos.2.rua')).toBeNull()
    expect(e.ilha.le().enderecos).toEqual([{ rua: 'Rua Um', numero: '' }, { rua: '', numero: '' }])
    await envia(e); expect(erroDe(e, 'enderecos.1.rua')).toBe('Rua é obrigatório.'); expect(erroDe(e, 'enderecos.0.rua')).toBe(''); expect(document.activeElement).toBe(rua(1)) // o erro caiu no item certo
    add.click(); digita(campo(e, 'enderecos.2.rua').querySelector('input')!, 'Rua Dois'); expect(e.ilha.le().enderecos).toHaveLength(3)
  })
  it('campos calculados e desabilitadosSe seguem os outros campos', async () => {
    const e = await monta({ campos: [{ nome: 'qtd', tipo: 'inteiro', padrao: 1 }, { nome: 'total', tipo: 'numero', calculado: 'valores.qtd * 5' }, { nome: 'cupom', tipo: 'texto', desabilitadoSe: 'valores.qtd < 2' }] })
    expect(ent(e, 'total').value).toBe('5'); expect(ent(e, 'total').disabled).toBe(true); expect(ent(e, 'cupom').disabled).toBe(true)
    digita(ent(e, 'qtd'), '3'); expect(ent(e, 'total').value).toBe('15'); expect(ent(e, 'cupom').disabled).toBe(false)
  })
})
