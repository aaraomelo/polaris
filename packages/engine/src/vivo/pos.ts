// Posição de construção. Toda construção emite nós EM ORDEM DE DOCUMENTO por aqui, de dois jeitos:
//   criar : cria o nó e o insere antes de `ref` (ou no fim de `pai`);
//   adotar: pega o próximo nó que o servidor já pôs no HTML (hidratação) e só confere que é o esperado.
// O mesmo código de construção serve aos dois: a hidratação não é um segundo caminho.

export class Divergencia extends Error {
  constructor(mensagem: string) { super(mensagem); this.name = 'Divergencia' }
}

export class Pos {
  constructor(readonly pai: Node, readonly ref: Node | null, readonly adota: boolean, private prox: Node | null = null) {}

  /** posição para construir os FILHOS de `el` */
  dentro(el: Element): Pos { return this.adota ? new Pos(el, null, true, el.firstChild) : new Pos(el, null, false) }

  el(tag: string): Element {
    if (!this.adota) return document.createElement(tag)
    const n = this.prox
    if (!n || n.nodeType !== 1 || (n as Element).localName !== tag) throw new Divergencia(`esperava <${tag}>, achou ${descreve(n)}`)
    this.prox = n.nextSibling
    return n as Element
  }

  com(): Comment {
    if (!this.adota) return document.createComment('')
    const n = this.prox
    if (!n || n.nodeType !== 8) throw new Divergencia(`esperava um marcador, achou ${descreve(n)}`)
    this.prox = n.nextSibling
    return n as Comment
  }

  /** insere o nó (criar) ou não faz nada (adotar: já está no lugar) */
  coloca(n: Node): void { if (!this.adota) this.pai.insertBefore(n, this.ref) }

  /** ao terminar de adotar os filhos de um elemento, não pode sobrar nó do servidor */
  confere(): void { if (this.adota && this.prox) throw new Divergencia(`sobrou ${descreve(this.prox)} no HTML do servidor`) }
}

const descreve = (n: Node | null) => (!n ? 'o fim' : n.nodeType === 1 ? `<${(n as Element).localName}>` : n.nodeType === 8 ? 'um comentário' : 'texto')
