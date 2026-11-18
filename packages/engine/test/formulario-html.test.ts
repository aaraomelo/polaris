import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderizaFormularioHtml } from '../src/index'

const exemplo = (n: string) => (JSON.parse(readFileSync(join(import.meta.dirname, '../../schema/test/exemplos/validos', n), 'utf8')) as { spec: any }).spec
const contato = exemplo('formulario-contato.json'), passos = exemplo('formulario-passos.json')

describe('prévia estática do formulário', () => {
  it('desenha título, seções, rótulos com * nos obrigatórios, ajuda, opções e botões', () => {
    const h = renderizaFormularioHtml(contato)
    expect(h).toContain('<h2>Fale conosco</h2>'); expect(h).toContain('<legend>Quem é você</legend>'); expect((h.match(/class="pl-secao"/g) ?? []).length).toBe(3)
    expect(h).toContain('Nome completo <span aria-hidden="true">*</span>'); expect(h).toContain('<option>Sobre um pedido</option>'); expect(h).toContain('<textarea'); expect(h).toContain('data-estilo="primario">Enviar mensagem</button>')
    expect(h).toContain('data-condicional="true"') // cpf e pedido têm `se`
    expect(h).toContain('placeholder="(11) 99999-0000"') // o placeholder do autor vence a dica da máscara
    expect(h).toMatch(/placeholder="000\.000\.000-00"/) // a dica vem da máscara quando não há placeholder
    expect(h).not.toMatch(/<script|onerror|javascript:/i); expect(h).toContain('disabled') // prévia: nada é editável
  })
  it('idioma: rótulos de opção e botões no idioma pedido', () => {
    expect(renderizaFormularioHtml(contato, { idioma: 'en' })).toContain('<option>Something else</option>')
    expect(renderizaFormularioHtml({ campos: [{ nome: 'a', tipo: 'escolha', opcoes: [{ valor: 1 }] }], envio: {} }, { idioma: 'en' })).toContain('Select…')
    expect(renderizaFormularioHtml({ campos: [{ nome: 'a', tipo: 'texto' }], envio: {} }, { idioma: 'en' })).toContain('>Submit</button>')
  })
  it('passos: só o passo pedido, lista de passos com o atual marcado, botões coerentes com o passo', () => {
    const p0 = renderizaFormularioHtml(passos, { passo: 0 }), p1 = renderizaFormularioHtml(passos, { passo: 1 })
    expect(p0).toContain('<li aria-current="step">Acesso</li>'); expect(p0).toContain('data-campo="senha"'); expect(p0).not.toContain('data-campo="cnpj"'); expect(p0).toContain('data-acao="avancar"'); expect(p0).not.toContain('data-acao="voltar"'); expect(p0).not.toContain('data-acao="enviar"')
    expect(p1).toContain('<li aria-current="step">Empresa</li>'); expect(p1).toContain('data-campo="cnpj"'); expect(p1).toContain('data-acao="voltar"'); expect(p1).toContain('data-acao="enviar"'); expect(p1).not.toContain('data-acao="avancar"')
    expect(renderizaFormularioHtml(passos, { passo: 99 })).toContain('<li aria-current="step">Empresa</li>') // limitado ao último
  })
  it('lista com um item de exemplo, grupo, opções dinâmicas, senha sem dica de máscara, oculto', () => {
    const h = renderizaFormularioHtml({ campos: [{ nome: 'l', tipo: 'lista', campos: [{ nome: 'rua', tipo: 'texto' }] }, { nome: 'g', tipo: 'grupo', campos: [{ nome: 'x', tipo: 'texto' }] }, { nome: 'p', tipo: 'escolha', opcoes: { dados: 'dados.paises' } }, { nome: 's', tipo: 'senha' }, { nome: 'o', tipo: 'oculto' }, { nome: 'm', tipo: 'multiescolha', opcoes: [{ valor: 'a', rotulo: 'A' }] }] })
    expect(h).toContain('class="pl-item"'); expect(h).toContain('Adicionar'); expect(h).toContain('(opções de dados.paises)'); expect(h).toContain('type="password"'); expect(h).toContain('type="hidden"'); expect(h).toContain('<legend>G</legend>'); expect(h).toContain('type="checkbox" disabled> A')
  })
  it('XSS: nenhum texto do autor vira HTML (título, rótulo, ajuda, opção, botão, nome do campo)', () => {
    const m = '"><img src=x onerror=alert(1)>'
    const h = renderizaFormularioHtml({ titulo: m, descricao: m, campos: [{ nome: m, tipo: 'escolha', rotulo: m, ajuda: m, placeholder: m, opcoes: [{ valor: 'a', rotulo: m }] }, { nome: 'b', tipo: 'texto', rotulo: { 'pt-BR': m } }], acoes: [{ id: m, rotulo: m, tipo: 'limpar' }] })
    expect(h).not.toMatch(/<img/i); expect(h).not.toContain('"><img'); expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
  it('definição quase vazia não quebra', () => { expect(renderizaFormularioHtml({ campos: [] })).toContain('<form class="pl-form"'); expect(renderizaFormularioHtml({ campos: [{ nome: 'a', tipo: 'texto' }], secoes: [{ id: 's', campos: ['inexistente'] }] })).toContain('data-campo="a"') })
})
