import { describe, expect, it } from 'vitest'
import { Historico } from '../src'

describe('histórico (desfazer/refazer)', () => {
  it('desfaz e refaz em ordem; novo estado apaga o futuro; rótulos', () => {
    const h = new Historico(0); h.aplica(1, 'um'); h.aplica(2, 'dois'); h.aplica(3, 'três')
    expect([h.atual, h.rotuloDesfazer, h.podeRefazer]).toEqual([3, 'três', false])
    expect(h.desfaz()).toBe(2); expect(h.rotuloRefazer).toBe('três'); expect(h.desfaz()).toBe(1); expect(h.refaz()).toBe(2)
    h.aplica(9, 'nove'); expect(h.podeRefazer).toBe(false); expect(h.desfaz()).toBe(2); expect(h.desfaz()).toBe(1); expect(h.desfaz()).toBe(0); expect(h.desfaz()).toBe(0); expect(h.podeDesfazer).toBe(false)
    expect(h.refaz()).toBe(1); expect(h.refaz()).toBe(2); expect(h.refaz()).toBe(9); expect(h.refaz()).toBe(9)
  })
  it('mesma referência é ignorada; grupo dentro da janela vira um passo; fora da janela ou outro grupo, não', () => {
    let t = 0; const h = new Historico<{ v: number }>({ v: 0 }, { agrupaMs: 500, agora: () => t }); const a = { v: 1 }
    h.aplica(a, 'x'); h.aplica(a, 'x'); expect(h.tamanho).toBe(2)
    t = 100; h.aplica({ v: 2 }, 'digitando', 'campo:a'); t = 300; h.aplica({ v: 3 }, 'digitando', 'campo:a'); t = 500; h.aplica({ v: 4 }, 'digitando', 'campo:a')
    expect(h.tamanho).toBe(3); expect(h.desfaz()).toBe(a) // um desfazer volta ao ANTES de começar a digitar
    h.refaz(); t = 5000; h.aplica({ v: 5 }, 'digitando', 'campo:a'); expect(h.tamanho).toBe(4) // janela vencida
    t = 5100; h.aplica({ v: 6 }, 'digitando', 'campo:b'); expect(h.tamanho).toBe(5) // outro campo
  })
  it('o primeiro passo nunca agrupa com o estado inicial (desfazer sempre tem para onde voltar)', () => {
    const h = new Historico(0, { agora: () => 0 }); h.aplica(1, 'a', 'g'); h.aplica(2, 'a', 'g'); expect(h.desfaz()).toBe(0); expect(h.podeDesfazer).toBe(false)
  })
  it('limite descarta os mais antigos; sujo/marcaSalvo; reinicia', () => {
    const h = new Historico(0, { limite: 3 }); for (let i = 1; i <= 10; i++) h.aplica(i, `p${i}`); let n = 0; while (h.podeDesfazer) { h.desfaz(); n++ } expect(n).toBe(3); expect(h.atual).toBe(7)
    const s = new Historico('a'); expect(s.sujo).toBe(false); s.aplica('b', 'x'); expect(s.sujo).toBe(true); s.marcaSalvo(); expect(s.sujo).toBe(false); s.desfaz(); expect(s.sujo).toBe(true); s.refaz(); expect(s.sujo).toBe(false)
    s.reinicia('z'); expect([s.atual, s.podeDesfazer, s.podeRefazer, s.sujo]).toEqual(['z', false, false, false])
  })
})
