import { describe, expect, it } from 'vitest'
import { Registry, analisaMascara, regexSegura, validaFormulario, type No } from '../src/index'

// Estrutura do `formulario`: o que o JSON Schema não diz (nomes, referências, máscaras por tipo, regex segura, envio contra o serviço real).
const SERVICO = { kind: 'servico', id: 'loja', versao: '1.0.0', estatuto: 'publicado', spec: { entidades: { contato: { campos: { nome: { tipo: 'texto', obrigatorio: true }, email: { tipo: 'texto', obrigatorio: true }, mensagem: { tipo: 'texto' } }, crud: { caminho: '/contatos', operacoes: ['criar'] } } }, operacoes: {} } }
const CONTAS = { kind: 'servico', id: 'contas', versao: '1.0.0', estatuto: 'publicado', spec: { entidades: { conta: { campos: { nome: { tipo: 'texto', obrigatorio: true }, senha: { tipo: 'texto', obrigatorio: true }, cnpj: { tipo: 'texto' }, cep: { tipo: 'texto' } }, crud: { caminho: '/contas', operacoes: ['criar'] } } }, operacoes: {} } }
const reg = () => { const r = new Registry(); r.registra(SERVICO); r.registra(CONTAS); r.registra({ kind: 'dados', id: 'dados.paises', versao: '1.0.0', estatuto: 'publicado', spec: { fonte: { tipo: 'estatico', valor: [] } } }); return r }
const f = (spec: Record<string, unknown>, id = 'f') => ({ kind: 'formulario', id, versao: '1.0.0', spec }) as unknown as No
const erros = (spec: Record<string, unknown>) => validaFormulario(reg(), f(spec)).map((e) => `${e.caminho}: ${e.mensagem}`)
const campo = (nome: string, extra: Record<string, unknown> = {}) => ({ nome, tipo: 'texto', ...extra })

describe('formulario: exemplos do repositório', () => {
  it('o exemplo completo (contato) é coerente com um serviço que tem criarContato', () => {
    const r = reg(), no = r.registra(require('./exemplos/validos/formulario-contato.json')); expect(r.verifica(no).map((e) => e.caminho + ' ' + e.mensagem)).toEqual([]); expect(validaFormulario(r, no).map((e) => e.caminho + ' ' + e.mensagem)).toEqual([])
  })
  it('o formulário em passos (com dados e máscara de CNPJ/CEP) é coerente', () => {
    const r = reg(); r.registra({ kind: 'dados', id: 'dados.cadastro', versao: '1.0.0', estatuto: 'publicado', spec: { fonte: { tipo: 'estatico', valor: {} } } })
    const no = r.registra(require('./exemplos/validos/formulario-passos.json')); expect(r.verifica(no).map((e) => e.caminho + ' ' + e.mensagem)).toEqual([]); expect(validaFormulario(r, no).map((e) => e.caminho + ' ' + e.mensagem)).toEqual([])
  })
  it('referências quebradas (dados, serviço) aparecem em verifica, com o caminho', () => {
    const r = new Registry(); const no = r.registra(f({ campos: [campo('a'), { nome: 'p', tipo: 'escolha', opcoes: { dados: 'dados.nada' } }], valoresIniciais: { dados: 'dados.edicao' }, envio: { servico: 'nao-existe', operacao: 'x' } }))
    expect(r.verifica(no).map((e) => e.caminho).sort()).toEqual(['/spec/campos/1/opcoes/dados', '/spec/envio/servico', '/spec/valoresIniciais/dados'])
  })
})

describe('formulario: nomes e referências entre campos', () => {
  it('nome repetido e nome reservado', () => {
    expect(erros({ campos: [campo('a'), campo('a')] })).toContain("/spec/campos/1/nome: já existe um campo 'a' neste formulário")
    expect(erros({ campos: [campo('valores')] }).join()).toMatch(/nome reservado/)
    expect(erros({ campos: [campo('item')] }).join()).toMatch(/nome reservado/)
  })
  it('grupos e listas têm escopo próprio (mesmo nome em níveis diferentes vale), mas não repetem dentro do mesmo nível', () => {
    expect(erros({ campos: [campo('rua'), { nome: 'ends', tipo: 'lista', campos: [campo('rua'), campo('cep')] }] })).toEqual([])
    expect(erros({ campos: [{ nome: 'ends', tipo: 'lista', campos: [campo('rua'), campo('rua')] }] }).join()).toMatch(/\/spec\/campos\/0\/campos\/1\/nome/)
  })
  it('igualA/diferenteDe precisam apontar para um campo do mesmo nível (e não para si), com sugestão', () => {
    expect(erros({ campos: [campo('senha'), campo('confirma', { validacao: { igualA: 'senh' } })] }).join()).toMatch(/'senh' não é um campo deste formulário.*|quis dizer 'senha'/)
    const e = validaFormulario(reg(), f({ campos: [campo('senha'), campo('confirma', { validacao: { igualA: 'senh' } })] })); expect(e[0]!.dica).toBe("quis dizer 'senha'?")
    expect(erros({ campos: [campo('a', { validacao: { diferenteDe: 'a' } })] }).join()).toMatch(/não pode ser diferente a si mesmo/)
  })
  it('seções: campo existente, um campo em uma seção só, ids únicos', () => {
    const c = [campo('a'), campo('b')]
    expect(erros({ campos: c, secoes: [{ id: 's1', campos: ['a', 'zzz'] }] }).join()).toMatch(/'zzz' não é um campo/)
    expect(erros({ campos: c, secoes: [{ id: 's1', campos: ['a'] }, { id: 's2', campos: ['a'] }] }).join()).toMatch(/já está na seção 's1'/)
    expect(erros({ campos: c, secoes: [{ id: 's1', campos: ['a'] }, { id: 's1', campos: ['b'] }] }).join()).toMatch(/já existe uma seção 's1'/)
  })
  it('passos: não convivem com seções, cada campo em um passo, nenhum campo de fora', () => {
    const c = [campo('a'), campo('b'), campo('c')]
    expect(erros({ campos: c, passos: [{ id: 'p1', titulo: 'x', campos: ['a'] }, { id: 'p2', titulo: 'y', campos: ['b'] }] }).join()).toMatch(/o campo 'c' não está em nenhum passo/)
    expect(erros({ campos: c, passos: [{ id: 'p1', titulo: 'x', campos: ['a', 'b'] }, { id: 'p2', titulo: 'y', campos: ['b', 'c'] }] }).join()).toMatch(/'b' já está no passo 'p1'/)
    expect(erros({ campos: [campo('a'), campo('b')], secoes: [{ id: 's', campos: ['a'] }], passos: [{ id: 'p1', titulo: 'x', campos: ['a'] }, { id: 'p2', titulo: 'y', campos: ['b'] }] }).join()).toMatch(/`passos` OU `secoes`/)
  })
  it('regras entre campos apontam para campos que existem; ids únicos', () => {
    expect(erros({ campos: [campo('a')], validacoes: [{ id: 'r', regra: 'true', mensagem: 'x', campos: ['b'] }] }).join()).toMatch(/\/spec\/validacoes\/0\/campos\/0/)
    expect(erros({ campos: [campo('a')], validacoes: [{ id: 'r', regra: 'true', mensagem: 'x' }, { id: 'r', regra: 'true', mensagem: 'y' }] }).join()).toMatch(/já existe uma regra 'r'/)
  })
})

describe('formulario: regras coerentes com o tipo do campo', () => {
  it('minimo/maximo só em número; tamanho só em texto; data só em data; itens só em lista; extensões só em arquivo', () => {
    expect(erros({ campos: [campo('t', { validacao: { minimo: 1 } })] }).join()).toMatch(/'minimo' só vale em campo numérico/)
    expect(erros({ campos: [{ nome: 'n', tipo: 'inteiro', validacao: { tamanhoMinimo: 2 } }] }).join()).toMatch(/'tamanhoMinimo' só vale em campo de texto/)
    expect(erros({ campos: [campo('t', { validacao: { dataMaxima: 'hoje' } })] }).join()).toMatch(/'dataMaxima' só vale em campo de data/)
    expect(erros({ campos: [campo('t', { validacao: { itensMinimo: 1 } })] }).join()).toMatch(/'itensMinimo' só vale em campo multiescolha ou lista/)
    expect(erros({ campos: [campo('t', { validacao: { extensoes: ['.pdf'] } })] }).join()).toMatch(/'extensoes' só vale em campo arquivo/)
  })
  it('limites invertidos e valores mal escritos', () => {
    expect(erros({ campos: [{ nome: 'n', tipo: 'numero', validacao: { minimo: 10, maximo: 5 } }] }).join()).toMatch(/minimo \(10\) é maior que maximo \(5\)/)
    expect(erros({ campos: [campo('t', { validacao: { tamanhoMinimo: 9, tamanhoMaximo: 3 } })] }).join()).toMatch(/tamanhoMinimo \(9\) é maior/)
    expect(erros({ campos: [{ nome: 'd', tipo: 'dinheiro', validacao: { minimo: '12,50' } }] }).join()).toMatch(/não é um número decimal/)
    expect(erros({ campos: [{ nome: 'd', tipo: 'data', validacao: { dataMinima: '31/01/2026' } }] }).join()).toMatch(/não é data ISO/)
    expect(erros({ campos: [{ nome: 'd', tipo: 'data', validacao: { dataMinima: 'hoje-18a', dataMaxima: '2030-12-31' } }] })).toEqual([])
  })
  it('formato só onde faz sentido', () => {
    expect(erros({ campos: [campo('t', { formato: { casasDecimais: 2 } })] }).join()).toMatch(/casasDecimais só vale em campo numérico/)
    expect(erros({ campos: [{ nome: 'n', tipo: 'numero', formato: { moeda: 'BRL' } }] }).join()).toMatch(/moeda só vale em campo 'dinheiro'/)
    expect(erros({ campos: [campo('t', { formato: { formatoData: 'dd/MM/yyyy' } })] }).join()).toMatch(/formatoData só vale em campo de data/)
  })
  it('opções literais: valores únicos; padrão de escolha precisa ser uma das opções; padrão de booleano é booleano', () => {
    expect(erros({ campos: [{ nome: 'c', tipo: 'escolha', opcoes: [{ valor: 'a' }, { valor: 'a' }] }] }).join()).toMatch(/aparece em mais de uma opção/)
    expect(erros({ campos: [{ nome: 'c', tipo: 'escolha', padrao: 'z', opcoes: [{ valor: 'a' }] }] }).join()).toMatch(/não é uma das opções/)
    expect(erros({ campos: [{ nome: 'b', tipo: 'booleano', padrao: 'sim' }] }).join()).toMatch(/true ou false/)
  })
})

describe('formulario: máscaras', () => {
  const mascara = (tipo: string, padrao: string | string[], extra: Record<string, unknown> = {}) => erros({ campos: [{ nome: 'm', tipo, mascara: { padrao, ...extra } }] }).join(' | ')
  it('analisaMascara conta lugares, dígitos e obrigatórios; escape vira literal; escape solto é inválido', () => {
    expect(analisaMascara('000.000.000-00')).toEqual({ lugares: 11, digitos: 11, obrigatorios: 11 })
    expect(analisaMascara('(00) 9 0000-0000')).toEqual({ lugares: 11, digitos: 11, obrigatorios: 10 })
    expect(analisaMascara('AAA-000')).toEqual({ lugares: 6, digitos: 3, obrigatorios: 6 })
    expect(analisaMascara('\\0 00')).toEqual({ lugares: 2, digitos: 2, obrigatorios: 2 }) // o primeiro 0 é literal
    expect(analisaMascara('00\\')).toBeNull(); expect(analisaMascara('---')).toEqual({ lugares: 0, digitos: 0, obrigatorios: 0 })
  })
  it('CPF, CNPJ, CEP e telefone exigem a quantidade certa de dígitos', () => {
    expect(mascara('cpf', '000.000.000-00')).toBe(''); expect(mascara('cnpj', '00.000.000/0000-00')).toBe(''); expect(mascara('cep', '00000-000')).toBe('')
    expect(mascara('cpf', '000.000.00-00')).toMatch(/10 posição\(ões\) de dígito, mas CPF tem 11/)
    expect(mascara('cnpj', '00.000.000-00')).toMatch(/CNPJ tem 14/); expect(mascara('cep', '0000-000')).toMatch(/CEP tem 8/)
    expect(mascara('telefone', ['(00) 0000-0000', '(00) 00000-0000'])).toBe(''); expect(mascara('telefone', '(00) 000-000')).toMatch(/um telefone com DDD tem 10 ou 11/)
    expect(mascara('cpf', '000.AAA.000-00')).toMatch(/só pode ter posições de dígito/)
  })
  it('máscara sem posição, escape solto, substituto que é símbolo, padrões repetidos', () => {
    expect(mascara('texto', '---')).toMatch(/não tem nenhuma posição para digitar/)
    expect(mascara('texto', '00\\')).toMatch(/termina em '\\\\'/)
    expect(mascara('texto', '000', { substituto: '0' })).toMatch(/'0' é um símbolo de máscara/)
    expect(mascara('texto', ['000', '000'])).toMatch(/padrões repetidos/)
  })
  it('tipo sem máscara (booleano, escolha, arquivo…) e número só com dígitos', () => {
    expect(mascara('booleano', '000')).toMatch(/não tem máscara/); expect(mascara('arquivo', '000')).toMatch(/não tem máscara/)
    expect(mascara('inteiro', 'AAA')).toMatch(/só aceita posições de dígito/); expect(mascara('inteiro', '0000')).toBe('')
    expect(mascara('texto', ['AAA-0000', 'AAA0A00'])).toBe('') // placas antiga e Mercosul
  })
})

describe('formulario: expressão regular segura', () => {
  it('aceita as comuns', () => { for (const r of ['[A-Z]{3}-[0-9]{6}', '\\d{5}-?\\d{3}', '[a-z]+@[a-z]+\\.com', '(foo|bar)baz']) expect(regexSegura(r), r).toBeNull() })
  it('recusa as que travam (aninhadas), as que não compilam, retrovisor e lookaround', () => {
    expect(regexSegura('(a+)+')).toMatch(/repetição aninhada/); expect(regexSegura('(a*)*b')).toMatch(/repetição aninhada/); expect(regexSegura('(\\d+)*')).toMatch(/repetição aninhada/); expect(regexSegura('(a{1,5})+')).toMatch(/repetição aninhada/)
    expect(regexSegura('(abc')).toMatch(/não compila/); expect(regexSegura('(a)\\1')).toMatch(/retrovisor/); expect(regexSegura('(?=a)a')).toMatch(/lookahead/); expect(regexSegura('x'.repeat(201))).toMatch(/200/)
  })
  it('vira erro no campo, com o caminho', () => { expect(erros({ campos: [campo('t', { validacao: { padrao: '(a+)+$' } })] }).join()).toMatch(/\/spec\/campos\/0\/validacao\/padrao: a expressão regular tem repetição aninhada/) })
})

describe('formulario: envio de sistema (login e senha)', () => {
  const c = (...cs: Array<[string, string]>) => cs.map(([nome, tipo]) => ({ nome, tipo }))
  it('o exemplo de login é coerente', () => { const r = reg(), no = r.registra(require('./exemplos/validos/formulario-login.json')); expect(r.verifica(no)).toEqual([]); expect(validaFormulario(r, no)).toEqual([]) })
  it('cada ação de sistema exige os campos certos, com o tipo certo, e diz como corrigir', () => {
    expect(erros({ campos: c(['email', 'email'], ['senha', 'senha']), envio: { sistema: 'entrar' } })).toEqual([]); expect(erros({ campos: c(['email', 'texto'], ['senha', 'senha']), envio: { sistema: 'entrar' } })).toEqual([])
    expect(erros({ campos: c(['email', 'email']), envio: { sistema: 'entrar' } }).join()).toMatch(/precisa de um campo 'senha' \(senha\)/)
    expect(erros({ campos: c(['email', 'email'], ['senha', 'texto']), envio: { sistema: 'entrar' } }).join()).toMatch(/o campo 'senha' deve ser do tipo senha \(este é 'texto'\)/)
    expect(erros({ campos: c(['email', 'email']), envio: { sistema: 'esqueci' } })).toEqual([]); expect(erros({ campos: c(['nome', 'texto']), envio: { sistema: 'esqueci' } }).join()).toMatch(/precisa de um campo 'email'/)
    expect(erros({ campos: c(['token', 'oculto'], ['senha', 'senha']), envio: { sistema: 'redefinir' } })).toEqual([]); expect(erros({ campos: c(['senha', 'senha']), envio: { sistema: 'redefinir' } }).join()).toMatch(/precisa de um campo 'token'/)
  })
  it('uma ação `enviar` com envio de sistema não precisa de serviço registrado', () => { expect(erros({ campos: c(['email', 'email'], ['senha', 'senha']), envio: { sistema: 'entrar' }, acoes: [{ id: 'e', rotulo: 'Entrar', tipo: 'enviar' }] })).toEqual([]) })
})

describe('formulario: ações e envio contra o serviço', () => {
  const c = [campo('nome'), campo('email'), campo('mensagem')]
  it('enviar exige `envio`; voltar/avançar exigem passos; ids únicos', () => {
    expect(erros({ campos: c, acoes: [{ id: 'e', rotulo: 'Enviar', tipo: 'enviar' }] }).join()).toMatch(/não declara `envio`/)
    expect(erros({ campos: c, acoes: [{ id: 'v', rotulo: 'Voltar', tipo: 'voltar' }] }).join()).toMatch(/só existe em formulário com `passos`/)
    expect(erros({ campos: c, acoes: [{ id: 'x', rotulo: 'A', tipo: 'limpar' }, { id: 'x', rotulo: 'B', tipo: 'limpar' }] }).join()).toMatch(/já existe uma ação 'x'/)
  })
  it('a operação existe (com sugestão), os argumentos são aceitos e os obrigatórios vão', () => {
    expect(erros({ campos: c, envio: { servico: 'loja', operacao: 'criarContato' } })).toEqual([])
    const e = validaFormulario(reg(), f({ campos: c, envio: { servico: 'loja', operacao: 'criarContat' } })); expect(e[0]!.mensagem).toMatch(/não tem a operação 'criarContat'/); expect(e[0]!.dica).toBe("quis dizer 'criarContato'?")
    expect(erros({ campos: c, envio: { servico: 'loja', operacao: 'criarContato', args: { nome: 'valores.nome', email: 'valores.email', tel: 'valores.nome' } } }).join()).toMatch(/não aceita o argumento 'tel'/)
    expect(erros({ campos: [campo('nome')], envio: { servico: 'loja', operacao: 'criarContato' } }).join()).toMatch(/exige 'email' e o formulário não o envia/)
    expect(erros({ campos: c, envio: { servico: 'loja', operacao: 'criarContato', args: { nome: 'valores.nome' } } }).join()).toMatch(/exige 'email' e o formulário não o envia.*|adicione args.email/)
  })
  it('serviço que não está no registro não é erro aqui (a referência quebrada é de `verifica`)', () => { expect(erros({ campos: c, envio: { servico: 'outro', operacao: 'x' } })).toEqual([]) })
})
