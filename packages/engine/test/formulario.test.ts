import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { aplicaMascara, comparaDecimais, confereExpressoes, cnpjValido, cpfValido, exibeComMascara, exibeData, exibeDecimal, lerDecimal, paraDataIso, resolveDataRef, telefoneValido, valorDaMascara, validaValores, type FormularioSpec } from '../src/index'

const exemplo = (n: string) => (JSON.parse(readFileSync(join(import.meta.dirname, '../../schema/test/exemplos/validos', n), 'utf8')) as { spec: FormularioSpec }).spec
const contato = exemplo('formulario-contato.json')
const HOJE = '2026-06-15'

describe('máscaras', () => {
  const cpf = { padrao: '000.000.000-00' }, tel = { padrao: ['(00) 0000-0000', '(00) 00000-0000'] }
  it('CPF: formata a cada tecla, completa com 11 dígitos, ignora o que não cabe', () => {
    expect(aplicaMascara('12345678901', cpf)).toMatchObject({ formatado: '123.456.789-01', bruto: '12345678901', completo: true, estouro: false })
    expect(['1', '12', '123', '1234', '123456', '1234567'].map((x) => aplicaMascara(x, cpf).formatado)).toEqual(['1', '12', '123', '123.4', '123.456', '123.456.7'])
    expect(aplicaMascara('12345', cpf).completo).toBe(false)
    expect(aplicaMascara('abc 123 x', cpf).bruto).toBe('123'); expect(aplicaMascara('123456789012345', cpf)).toMatchObject({ bruto: '12345678901', estouro: true })
  })
  it('colar o valor já formatado (ou com lixo) dá o mesmo resultado', () => {
    for (const colado of ['123.456.789-01', '  123.456.789-01 ', '123456789-01', 'CPF: 123.456.789-01']) expect(aplicaMascara(colado, cpf).bruto, colado).toBe('12345678901')
  })
  it('lista de máscaras: o telefone troca de 10 para 11 dígitos sozinho', () => {
    expect(aplicaMascara('1122223333', tel).formatado).toBe('(11) 2222-3333'); expect(aplicaMascara('11922223333', tel).formatado).toBe('(11) 92222-3333')
    expect(aplicaMascara('112222', tel).formatado).toBe('(11) 2222'); expect(aplicaMascara('(11) 92222-3333', tel).bruto).toBe('11922223333')
    expect(aplicaMascara('1122223333', tel).completo).toBe(true); expect(aplicaMascara('112222333', tel).completo).toBe(false)
  })
  it('letras, alfanuméricos, escape e posição opcional', () => {
    expect(aplicaMascara('abc1234', { padrao: 'AAA-0000', maiusculas: true }).formatado).toBe('ABC-1234'); expect(aplicaMascara('ab1', { padrao: 'AAA-0000' }).bruto).toBe('ab') // dígito onde se espera letra: descartado
    expect(aplicaMascara('ABC1D23', { padrao: ['AAA-0000', 'AAA0A00'] }).formatado).toBe('ABC1D23') // placa Mercosul: o primeiro padrão não comporta, vale o segundo
    expect(aplicaMascara('ABC1234', { padrao: ['AAA-0000', 'AAA0A00'] }).formatado).toBe('ABC-1234')
    expect(aplicaMascara('12', { padrao: '\\0 00' }).formatado).toBe('0 12') // o primeiro 0 é literal
    const opc = { padrao: '000.9' }; expect(aplicaMascara('123', opc).completo).toBe(true); expect(aplicaMascara('1234', opc).formatado).toBe('123.4') // o 9 é opcional
    expect(aplicaMascara('x1!', { padrao: 'a-a' }).formatado).toBe('x-1')
  })
  it('valor guardado: sem literais por padrão, com literais se pedido; exibição com substituto', () => {
    expect(valorDaMascara('123.456.789-01', cpf)).toBe('12345678901'); expect(valorDaMascara('12345678901', { ...cpf, enviaComLiterais: true })).toBe('123.456.789-01')
    expect(exibeComMascara('1122', { padrao: '(00) 0000-0000', substituto: '_' })).toBe('(11) 22__-____'); expect(exibeComMascara('', { padrao: '00/00', substituto: '_' })).toBe('__/__')
    expect(aplicaMascara('1234', { padrao: '00/00', mostraLiterais: false }).formatado).toBe('12/34'); expect(aplicaMascara('12', { padrao: '00/00', mostraLiterais: false }).formatado).toBe('12')
  })
  it('PROPRIEDADES: aplicar duas vezes não muda; o bruto do formatado é o bruto; nunca lança; nunca passa do padrão', () => {
    const padroes = [cpf, tel, { padrao: 'AAA-0000' }, { padrao: '(00) 9 0000-0000' }, { padrao: 'a*a' }]
    let s = 12345
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const alfabeto = '0123456789abcXYZ .-/()áé\\\\*9A'
    for (let i = 0; i < 3000; i++) {
      const entrada = Array.from({ length: Math.floor(rnd() * 25) }, () => alfabeto[Math.floor(rnd() * alfabeto.length)]).join(''), o = padroes[i % padroes.length]!
      const r = aplicaMascara(entrada, o), r2 = aplicaMascara(r.formatado, o)
      expect(r2.formatado, `${JSON.stringify(entrada)} / ${JSON.stringify(o.padrao)}`).toBe(r.formatado); expect(r2.bruto).toBe(r.bruto)
      expect([...r.bruto].length).toBeLessThanOrEqual(Math.max(...(typeof o.padrao === 'string' ? [o.padrao] : o.padrao).map((p) => p.length)))
    }
  })
  it('entrada gigante é cortada (não trava)', () => { const t0 = Date.now(); const r = aplicaMascara('1'.repeat(5_000_000), cpf); expect(r.bruto).toBe('12345678901'.replace(/./g, '1')); expect(Date.now() - t0).toBeLessThan(500) })
})

describe('formatos brasileiros', () => {
  it('CPF e CNPJ com dígito verificador', () => {
    for (const ok of ['529.982.247-25', '52998224725', '111.444.777-35']) expect(cpfValido(ok), ok).toBe(true)
    for (const ruim of ['529.982.247-24', '11111111111', '123', '', '5299822472a']) expect(cpfValido(ruim), ruim).toBe(false)
    for (const ok of ['11.222.333/0001-81', '11222333000181']) expect(cnpjValido(ok), ok).toBe(true)
    for (const ruim of ['11.222.333/0001-82', '00000000000000', '123']) expect(cnpjValido(ruim), ruim).toBe(false)
  })
  it('telefone com DDD: fixo de 10 e celular de 11 que começa com 9', () => {
    for (const ok of ['1122223333', '11922223333', '(21) 3333-4444']) expect(telefoneValido(ok), ok).toBe(true)
    for (const ruim of ['112222333', '1012223333', '11822223333', '1112223333', '119222233334']) expect(telefoneValido(ruim), ruim).toBe(false)
  })
  it('datas reais (bissexto), formatos de exibição e referências relativas a hoje', () => {
    expect(paraDataIso('29/02/2024')).toBe('2024-02-29'); expect(paraDataIso('29/02/2025')).toBeNull(); expect(paraDataIso('31/04/2026')).toBeNull(); expect(paraDataIso('1/3/2026')).toBe('2026-03-01')
    expect(paraDataIso('03/15/2026', 'MM/dd/yyyy')).toBe('2026-03-15'); expect(paraDataIso('2026-03-15')).toBe('2026-03-15'); expect(paraDataIso('15-03-2026')).toBeNull()
    expect(exibeData('2026-03-15')).toBe('15/03/2026'); expect(exibeData('2026-03-15', 'MM/dd/yyyy')).toBe('03/15/2026')
    expect([resolveDataRef('hoje', HOJE), resolveDataRef('hoje+30d', HOJE), resolveDataRef('hoje-18a', HOJE), resolveDataRef('hoje+8m', HOJE), resolveDataRef('2030-01-01', HOJE), resolveDataRef('amanha', HOJE)]).toEqual(['2026-06-15', '2026-07-15', '2008-06-15', '2027-02-15', '2030-01-01', null])
    expect(resolveDataRef('hoje-1a', '2024-02-29')).toBe('2023-02-28') // dia 29/02 não existe no ano anterior
  })
  it('decimal exato: leitura pt-BR e internacional, recusa do ambíguo, comparação sem ponto flutuante', () => {
    expect([lerDecimal('1.234,56'), lerDecimal('1234,5'), lerDecimal('R$ 12,50'), lerDecimal('0,10'), lerDecimal('-3,00'), lerDecimal('1.000'), lerDecimal('007')]).toEqual(['1234.56', '1234.5', '12.5', '0.1', '-3', '1000', '7'])
    expect([lerDecimal('1,234.56', '.'), lerDecimal('12.5', '.')]).toEqual(['1234.56', '12.5'])
    for (const ruim of ['', 'abc', '1,2,3', '1.2,3,4', '--1', '1,']) expect(lerDecimal(ruim), ruim).toBeNull()
    expect(comparaDecimais('0.1', '0.10000000000000001')).toBe(-1); expect(comparaDecimais('100000', '100000.00')).toBe(0); expect(comparaDecimais('-1', '0')).toBe(-1); expect(comparaDecimais('x', '1')).toBeNull()
    expect([exibeDecimal('1234.5', { casasDecimais: 2, agrupaMilhar: true, prefixo: 'R$ ' }), exibeDecimal('-0.5', { casasDecimais: 2 }), exibeDecimal('1234567', { agrupaMilhar: true, separadorDecimal: '.' })]).toEqual(['R$ 1.234,50', '-0,50', '1,234,567'])
  })
})

describe('validador: o formulário de contato completo', () => {
  const ok = { nome: '  Ana   Maria  ', email: ' ANA@Exemplo.COM ', telefone: '(11) 92222-3333', assunto: 'duvida', mensagem: 'Gostaria de saber o prazo.', aceite: true, valorCompra: '1.234,50', dataCompra: '10/03/2026', extra: 'descartado', __proto__: { x: 1 } }
  const v = (b: Record<string, unknown>, o = {}) => validaValores(contato, b, { hoje: HOJE, ...o })
  it('valores normalizados e tipados; campos fora do formulário são descartados', () => {
    const r = v(ok); expect(r.erros).toEqual([]); expect(r.ok).toBe(true)
    expect(r.valores).toMatchObject({ nome: 'Ana Maria', email: 'ana@exemplo.com', telefone: '11922223333', assunto: 'duvida', valorCompra: '1234.5', dataCompra: '2026-03-10', aceite: true, retorno: false })
    expect(Object.keys(r.valores).sort()).toEqual(['aceite', 'assunto', 'dataCompra', 'email', 'mensagem', 'nome', 'retorno', 'telefone', 'valorCompra']) // sem `extra`, sem cpf/pedido (ocultos)
  })
  it('obrigatórios (com a mensagem do campo e a do formulário), booleano de aceite e ordem dos erros', () => {
    const r = v({}); const por = r.porCampo
    expect(por.nome![0]!.mensagem).toBe('Diga como podemos chamar você.'); expect(por.email![0]!.mensagem).toBe('E-mail é obrigatório.'); expect(por.aceite![0]!.mensagem).toBe('Precisamos do seu aceite para responder.'); expect(por.mensagem![0]!.mensagem).toBe('Mensagem é obrigatório.')
    expect(Object.keys(por)).toEqual(expect.arrayContaining(['nome', 'email', 'assunto', 'mensagem', 'aceite'])); expect(por.telefone).toBeUndefined() // opcional e vazio: sem erro
    expect(v({ ...ok, aceite: false }).porCampo.aceite![0]!.regra).toBe('obrigatorio')
  })
  it('formato do e-mail e do telefone, tamanho mínimo (com {min}), placeholders', () => {
    expect(v({ ...ok, email: 'ana@' }).porCampo.email![0]).toMatchObject({ regra: 'formato', mensagem: 'E-mail está em um formato inválido.' })
    expect(v({ ...ok, telefone: '123' }).porCampo.telefone![0]).toMatchObject({ regra: 'formato', mensagem: 'Informe o telefone com DDD.' })
    expect(v({ ...ok, nome: 'Al' }).porCampo.nome![0]!.mensagem).toBe('O nome precisa de pelo menos 3 letras.')
    expect(v({ ...ok, mensagem: 'x'.repeat(2001) }).porCampo.mensagem![0]!.mensagem).toBe('Mensagem aceita até 2000 caracteres.')
  })
  it('campos condicionais: aparecem e se tornam obrigatórios conforme as respostas; o oculto é descartado', () => {
    const sem = v(ok); expect(sem.valores).not.toHaveProperty('cpf'); expect(sem.valores).not.toHaveProperty('pedido')
    const ped = v({ ...ok, assunto: 'pedido' }); expect(ped.porCampo.pedido![0]!.regra).toBe('obrigatorio')
    expect(v({ ...ok, assunto: 'pedido', pedido: 'ab-1' }).porCampo.pedido![0]).toMatchObject({ regra: 'formato' }) // a máscara AAA-000000 não completou
    expect(v({ ...ok, assunto: 'pedido', pedido: 'abc123456' }).valores).toMatchObject({ pedido: 'ABC123456' }) // maiúsculas pela máscara, sem literais
    const ret = v({ ...ok, retorno: true, cpf: '529.982.247-25' }); expect(ret.erros).toEqual([]); expect(ret.valores).toMatchObject({ cpf: '52998224725', retorno: true })
    expect(v({ ...ok, retorno: true }).porCampo.cpf![0]!.regra).toBe('obrigatorio'); expect(v({ ...ok, retorno: true, cpf: '111.111.111-11' }).porCampo.cpf![0]!.regra).toBe('formato')
    expect(v({ ...ok, retorno: false, cpf: '123' }).valores).not.toHaveProperty('cpf') // oculto não valida nem volta
  })
  it('regra entre campos (retorno exige telefone) aponta para os campos listados; só roda no envio', () => {
    const r = v({ ...ok, telefone: '', retorno: true, cpf: '529.982.247-25' }); expect(r.porCampo.telefone![0]).toMatchObject({ regra: 'retornoComTelefone', mensagem: 'Para retorno por telefone, informe o telefone.' }); expect(r.porCampo.retorno![0]!.regra).toBe('retornoComTelefone')
    expect(v({ ...ok, telefone: '', retorno: true, cpf: '529.982.247-25' }, { quando: 'sair' }).porCampo.telefone).toBeUndefined() // `quando: enviar`
  })
  it('regra do campo por expressão (links proibidos), regex do pedido e datas relativas a hoje', () => {
    expect(v({ ...ok, mensagem: 'veja http://x.com agora' }).porCampo.mensagem![0]).toMatchObject({ regra: 'semLinks', mensagem: 'Por segurança, não aceitamos links na mensagem.' })
    expect(v({ ...ok, dataCompra: '16/06/2026' }).porCampo.dataCompra![0]!.mensagem).toBe('A data não pode ser no futuro.')
    expect(v({ ...ok, dataCompra: '15/06/2026' }).erros).toEqual([]); expect(v({ ...ok, dataCompra: '14/06/2021' }).porCampo.dataCompra![0]).toMatchObject({ regra: 'dataMinima', mensagem: 'Data da compra deve ser a partir de 15/06/2021.' })
    expect(v({ ...ok, dataCompra: '31/02/2026' }).porCampo.dataCompra![0]!.regra).toBe('formato')
  })
  it('dinheiro EXATO: limites sem arredondamento e no máximo 2 casas', () => {
    expect(v({ ...ok, valorCompra: '0,01' }).erros).toEqual([]); expect(v({ ...ok, valorCompra: '0,00' }).porCampo.valorCompra![0]).toMatchObject({ regra: 'minimo', mensagem: 'Valor da compra deve ser no mínimo 0.01.' })
    expect(v({ ...ok, valorCompra: '100.000,01' }).porCampo.valorCompra![0]!.regra).toBe('maximo'); expect(v({ ...ok, valorCompra: '100.000,00' }).erros).toEqual([])
    expect(v({ ...ok, valorCompra: '1,005' }).porCampo.valorCompra![0]!.regra).toBe('formato'); expect(v({ ...ok, valorCompra: 'abc' }).porCampo.valorCompra![0]!.regra).toBe('tipo')
  })
  it('limites decimais são EXATOS (onde o ponto flutuante erraria): 100.0000000000000001 passa de 100', () => {
    const s = { campos: [{ nome: 'p', tipo: 'percentual', validacao: { minimo: '0.1', maximo: '100' } }] } as FormularioSpec
    expect(validaValores(s, { p: '100.0000000000000001' }).porCampo.p![0]!.regra).toBe('maximo'); expect(validaValores(s, { p: '100' }).ok).toBe(true)
    expect(validaValores(s, { p: '0.0999999999999999999' }).porCampo.p![0]!.regra).toBe('minimo'); expect(validaValores(s, { p: '0.1' }).ok).toBe(true)
  })
  it('escolha: só as opções declaradas; i18n: o idioma pedido, com queda para o padrão', () => {
    expect(v({ ...ok, assunto: 'hackeado' }).porCampo.assunto![0]).toMatchObject({ regra: 'opcao', mensagem: 'Escolha uma opção válida em Assunto.' })
    const en = v({}, { idioma: 'en' }); expect(en.porCampo.email![0]!.mensagem).toBe('E-mail é obrigatório.') // a mensagem do formulário (pt-BR) vale: o autor escreveu só em pt-BR
    expect(validaValores({ campos: [{ nome: 'a', tipo: 'texto', obrigatorio: true }] }, {}, { idioma: 'en' }).erros[0]!.mensagem).toBe('A is required.') // padrão do sistema, em inglês
    expect(validaValores({ campos: [{ nome: 'a', tipo: 'texto', obrigatorio: true, mensagens: { obrigatorio: { 'pt-BR': 'Falta.', en: 'Missing.' } } }] }, {}, { idioma: 'en-GB' }).erros[0]!.mensagem).toBe('Missing.')
  })
  it('um passo do assistente valida só os seus campos', () => {
    const r = validaValores(contato, {}, { hoje: HOJE, campos: ['nome', 'email'] }); expect(Object.keys(r.porCampo).sort()).toEqual(['email', 'nome'])
  })
})

describe('validador: demais regras', () => {
  const f = (campos: FormularioSpec['campos'], extra: Partial<FormularioSpec> = {}) => ({ campos, ...extra }) as FormularioSpec
  it('igualA (confirmação de senha) e diferenteDe', () => {
    const s = f([{ nome: 'senha', tipo: 'senha', rotulo: 'Senha' }, { nome: 'confirma', tipo: 'senha', rotulo: 'Confirmação', validacao: { igualA: 'senha' } }])
    expect(validaValores(s, { senha: 'abc12345', confirma: 'abc12345' }).ok).toBe(true); expect(validaValores(s, { senha: 'abc12345', confirma: 'x' }).erros[0]).toMatchObject({ campo: 'confirma', mensagem: 'Confirmação deve ser igual a Senha.' })
  })
  it('lista: itens validados com caminho `lista.i.campo`, mínimo e máximo de itens, valores só dos campos declarados', () => {
    const s = f([{ nome: 'ends', tipo: 'lista', validacao: { itensMinimo: 1, itensMaximo: 2 }, campos: [{ nome: 'rua', tipo: 'texto', obrigatorio: true }, { nome: 'numero', tipo: 'inteiro' }] }])
    const r = validaValores(s, { ends: [{ rua: 'A', numero: '10', x: 1 }, { numero: 'abc' }] }); expect(r.erros.map((e) => `${e.campo}:${e.regra}`)).toEqual(['ends.1.rua:obrigatorio', 'ends.1.numero:tipo']); expect((r.valores.ends as unknown[])[0]).toEqual({ rua: 'A', numero: 10 })
    expect(validaValores(s, { ends: [] }).porCampo.ends![0]!.regra).toBe('itensMinimo') // lista vazia que exige itens
    expect(validaValores(s, { ends: [{ rua: 'a' }, { rua: 'b' }, { rua: 'c' }] }).porCampo.ends![0]!.regra).toBe('itensMaximo')
  })
  it('somenteLeitura, desabilitado e calculado: o que o cliente manda é IGNORADO (o servidor decide)', () => {
    const s = f([{ nome: 'preco', tipo: 'dinheiro', somenteLeitura: true, padrao: '10.00' }, { nome: 'qtd', tipo: 'inteiro', padrao: 1 }, { nome: 'total', tipo: 'numero', calculado: 'valores.qtd * 5' }, { nome: 'cupom', tipo: 'texto', desabilitadoSe: 'valores.qtd < 2', padrao: 'SEM' }])
    expect(validaValores(s, { preco: '0.01', qtd: '3', total: '999', cupom: 'ABC' }).valores).toEqual({ preco: '10.00', qtd: 3, total: 15, cupom: 'ABC' })
    expect(validaValores(s, { qtd: '1', cupom: 'ABC' }).valores).toMatchObject({ qtd: 1, total: 5, cupom: 'SEM' })
  })
  it('regex do autor, tamanho em caracteres (emoji conta 1), normalizações e tipos de texto sem lixo', () => {
    const s = f([{ nome: 'c', tipo: 'texto', validacao: { padrao: '[A-Z]{2}\\d{2}', tamanhoMaximo: 4 } }, { nome: 'n', tipo: 'texto', normaliza: ['aparar', 'semAcentos', 'maiusculas'] }])
    expect(validaValores(s, { c: 'AB12', n: ' José ' }).valores).toEqual({ c: 'AB12', n: 'JOSE' }); expect(validaValores(s, { c: 'ab12' }).porCampo.c![0]!.regra).toBe('padrao'); expect(validaValores(s, { c: 'AB123' }).porCampo.c!.map((e) => e.regra)).toEqual(['tamanhoMaximo', 'padrao'])
    expect(validaValores(f([{ nome: 'e', tipo: 'texto', validacao: { tamanhoMaximo: 3 } }]), { e: '😀😀😀' }).ok).toBe(true)
    expect(validaValores(f([{ nome: 'x', tipo: 'texto' }]), { x: { a: 1 } }).porCampo.x![0]!.regra).toBe('tipo'); expect(validaValores(f([{ nome: 'x', tipo: 'texto' }]), { x: ['a'] }).porCampo.x![0]!.regra).toBe('tipo')
  })
  it('arquivo: extensão e tamanho; multiescolha: itens e opções; escolha volta ao tipo da opção', () => {
    const s = f([{ nome: 'doc', tipo: 'arquivo', validacao: { extensoes: ['.pdf'], tamanhoMaximoBytes: 1000 } }, { nome: 'tags', tipo: 'multiescolha', validacao: { itensMinimo: 1, itensMaximo: 2 }, opcoes: [{ valor: 'a' }, { valor: 'b' }, { valor: 'c' }] }, { nome: 'n', tipo: 'escolha', opcoes: [{ valor: 1 }, { valor: 2, desabilitado: true }] }])
    expect(validaValores(s, { doc: { nome: 'x.PDF', tamanho: 10 }, tags: ['a'], n: '1' }).valores).toEqual({ doc: { nome: 'x.PDF', tamanho: 10 }, tags: ['a'], n: 1 })
    expect(validaValores(s, { doc: { nome: 'x.exe', tamanho: 5000 }, tags: ['a'] }).erros.map((e) => e.regra)).toEqual(['extensao', 'tamanhoArquivo']); expect(validaValores(s, { tags: ['a', 'b', 'c'] }).porCampo.tags![0]!.regra).toBe('itensMaximo'); expect(validaValores(s, { tags: ['z'] }).porCampo.tags![0]!.regra).toBe('opcao'); expect(validaValores(s, { n: '2' }).porCampo.n![0]!.regra).toBe('opcao') // desabilitada
  })
  it('opções dinâmicas (de `dados`): conferidas quando o servidor fornece a lista', () => {
    const s = f([{ nome: 'pais', tipo: 'escolha', opcoes: { dados: 'dados.paises' } }])
    expect(validaValores(s, { pais: 'BR' }, { opcoesDinamicas: { pais: ['BR', 'PT'] } }).ok).toBe(true); expect(validaValores(s, { pais: 'XX' }, { opcoesDinamicas: { pais: ['BR', 'PT'] } }).porCampo.pais![0]!.regra).toBe('opcao'); expect(validaValores(s, { pais: 'XX' }).ok).toBe(true)
  })
  it('expressão que falha NUNCA aprova a regra; `se` que falha mantém o campo visível', () => {
    expect(validaValores(f([{ nome: 'a', tipo: 'texto', validacao: { regras: [{ expr: 'naoExiste(valor)', mensagem: 'x' }] } }]), { a: 'q' }).ok).toBe(false)
    expect(validaValores(f([{ nome: 'a', tipo: 'texto', obrigatorio: true, se: 'naoExiste(1)' }]), {}).ok).toBe(false)
  })
  it('PROPRIEDADES: entradas hostis nunca lançam, só devolvem campos declarados e erros bem formados', () => {
    let s = 7; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const lixos: unknown[] = [null, undefined, 0, -1, 1e308, NaN, Infinity, '', ' ', 'x'.repeat(5000), '\u0000', '<script>', "'; DROP", [], [[]], {}, { __proto__: null }, { constructor: 1 }, true, [1, 2], { nome: { a: 1 } }]
    const nomes = ['nome', 'email', 'telefone', 'cpf', 'assunto', 'pedido', 'valorCompra', 'dataCompra', 'mensagem', 'retorno', 'aceite', 'zzz', '__proto__', 'constructor']
    for (let i = 0; i < 2000; i++) {
      const b: Record<string, unknown> = Object.create(null); for (const n of nomes) if (rnd() < 0.7) b[n] = lixos[Math.floor(rnd() * lixos.length)]
      const r = validaValores(contato, b, { hoje: HOJE })
      expect(r.ok).toBe(r.erros.length === 0); for (const e of r.erros) { expect(typeof e.mensagem).toBe('string'); expect(e.mensagem).not.toMatch(/undefined|NaN|\[object|\{rotulo\}/) }
      const declarados = new Set(contato.campos.map((c) => c.nome)); for (const k of Object.keys(r.valores)) expect(declarados.has(k)).toBe(true)
      expect(Object.getPrototypeOf(r.valores)).toBe(Object.prototype)
    }
  })
})

describe('confereExpressoes', () => {
  it('os exemplos do repositório estão limpos', () => { expect(confereExpressoes(contato)).toEqual([]); expect(confereExpressoes(exemplo('formulario-passos.json'))).toEqual([]) })
  it('aponta sintaxe, variável desconhecida e função inexistente, com o caminho', () => {
    const e = confereExpressoes({ campos: [{ nome: 'a', tipo: 'texto', se: 'valores.x ==', obrigatorioSe: 'foo > 1', validacao: { regras: [{ expr: 'naoExiste(valor)', mensagem: 'm' }, { expr: 'valor == 1', mensagem: 'ok' }] } }], validacoes: [{ id: 'r', regra: 'valor == 1', mensagem: 'm' }] })
    expect(e.map((x) => x.split(':')[0])).toEqual(['/spec/campos/0/se', '/spec/campos/0/obrigatorioSe', '/spec/campos/0/validacao/regras/0/expr', '/spec/validacoes/0/regra'])
  })
})
