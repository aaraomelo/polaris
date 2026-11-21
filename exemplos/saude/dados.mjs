// As 160 contas de demonstração do painel de saúde (uma carteira de clientes B2B), geradas de forma DETERMINÍSTICA (mesma semente, mesmos dados).
// Distribuição pensada para o painel: 30 Enterprise, 55 Mid-Market e 75 SMB; ARR somando ~US$ 26,6 M; ~28 contas abaixo do limite de risco (40); mediana ~88.
// O ambiente local as guarda na API (entidade `conta` do serviço `loja`) pelo arquivo `conta.sementes`; em produção viriam do CRM.

const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const rnd = mulberry32(20261121)
const entre = (a, b) => a + rnd() * (b - a)
const inteiro = (a, b) => Math.round(entre(a, b))
const escolhe = (l) => l[Math.floor(rnd() * l.length)]
const kebab = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const PRIMEIROS = ['Fenwick', 'Marlowe', 'Ironpine', 'Norvale', 'Bastion', 'Blackfell', 'Strathmore', 'Redmoor', 'Northwind', 'Halcyon', 'Granite', 'Meridian', 'Hollowell', 'Alderbrook', 'Brightwater', 'Cobalt', 'Dunmore', 'Eastvale', 'Foxglove', 'Greystone', 'Harlow', 'Ivywood', 'Juniper', 'Kestrel', 'Lakeshore', 'Millbrook', 'Nightingale', 'Oakridge', 'Pinecrest', 'Quarry', 'Ravenwood', 'Silverline', 'Thornfield', 'Umber', 'Vantage', 'Westmark', 'Yarrow', 'Zephyr', 'Ashford', 'Birchfield', 'Cedarpoint', 'Driftwood', 'Elmhurst', 'Fairhaven', 'Glenmoor', 'Highgate', 'Irongate', 'Kingsley', 'Larkspur', 'Mapleton', 'Newhaven', 'Orchard', 'Pemberton', 'Redfern', 'Stonebridge', 'Tidewater', 'Upland', 'Verity', 'Whitcombe', 'Ainsley']
const SEGUNDOS = ['Legal', 'Capital', 'Energy', 'Analytics', 'Bank', 'Mutual', 'Textiles', 'Steel', 'Logistics', 'Health', 'Systems', 'Foods', 'Labs', 'Media', 'Group', 'Partners', 'Ports', 'Aviation', 'Claims', 'Petroleum', 'Software', 'Retail']
const RESPONSAVEIS = ['Tomas Vega', 'Priya Raman', 'Lena Okafor', 'Marcus Hale', 'Ines Duarte', 'Noah Bergstrom', 'Amara Singh', 'Felix Weber', 'Sofia Marchetti', 'Jonas Lind', 'Yara Haddad', 'Diego Salas']
const ROTULOS = ['uso', 'adocao', 'suporte', 'campeao', 'recursos', 'comercial'] // as seis variações sobre a base 55 (Product usage trend, Breadth of adoption, Support burden, Champion engagement, Feature depth, Commercial signal)

// as oito contas que o painel destaca na lista de atenção (os maiores recuos nas últimas 13 semanas), com os números do template
const FIXAS = [
  { nome: 'Fenwick Legal', arr: 720000, saude: 22, queda: -37, autonomia: null, assentos: 31, semana: -2, contato: 29, renovacao: '2027-05-24', resp: 'Tomas Vega', comp: [-21, -8, 2, -16, -1, 11] },
  { nome: 'Marlowe Capital', arr: 840000, saude: 54, queda: -34, autonomia: 2, assentos: 63, semana: -6, contato: 47, renovacao: '2027-03-15' },
  { nome: 'Ironpine Energy', arr: 610000, saude: 28, queda: -37, autonomia: null, assentos: 50, semana: -4, contato: 32, renovacao: '2027-04-18' },
  { nome: 'Norvale Petroleum', arr: 566000, saude: 51, queda: -31, autonomia: 2, assentos: 65, semana: -7, contato: 36, renovacao: '2027-08-14' },
  { nome: 'Bastion Claims', arr: 455000, saude: 31, queda: -31, autonomia: null, assentos: 40, semana: -4, contato: 2, renovacao: '2027-10-16' },
  { nome: 'Blackfell Ports', arr: 388000, saude: 26, queda: -37, autonomia: null, assentos: 32, semana: -4, contato: 10, renovacao: '2027-06-26' },
  { nome: 'Strathmore Group', arr: 472000, saude: 47, queda: -34, autonomia: 1, assentos: 56, semana: -7, contato: 34, renovacao: '2027-08-17' },
  { nome: 'Redmoor Aviation', arr: 342000, saude: 30, queda: -34, autonomia: null, assentos: 56, semana: -2, contato: 62, renovacao: '2027-11-09' },
]
const SEGMENTOS = [['enterprise', 30, 16_400_000, 9], ['mid-market', 55, 7_500_000, 10], ['smb', 75, 2_600_000, 9]] // [segmento, contas, ARR total, contas em risco]

/** a trajetória das últimas 13 semanas: o pico (`saude - queda`) cai até a saúde atual, com ruído; o máximo da série é exatamente o pico */
function historico(saude, queda) {
  const pico = saude - queda, ponto = queda === 0 ? 12 : inteiro(0, 3), h = []
  for (let w = 0; w < 13; w++) {
    const t = w <= ponto ? 0 : Math.pow((w - ponto) / (12 - ponto), 0.6)
    h.push(Math.max(0, Math.min(pico, Math.round(pico + (saude - pico) * t + (w === 12 || w === ponto ? 0 : entre(-1.6, 1.6))))))
  }
  h[ponto] = pico; h[12] = saude
  for (let w = 0; w < 13; w++) if (h[w] > pico) h[w] = pico
  return h
}
/** as seis variações que, somadas à base 55, dão a saúde atual */
function composicao(saude) {
  const alvo = saude - 55, pesos = ROTULOS.map(() => entre(0.3, 1)), soma = pesos.reduce((a, b) => a + b, 0)
  const v = pesos.map((p, i) => Math.round((alvo * p) / soma + entre(-6, 6) * (i % 2 ? 1 : -1)))
  v[5] += alvo - v.reduce((a, b) => a + b, 0)
  return v
}
const dataRenovacao = (dentroDe90) => {
  const base = Date.UTC(2026, 10, 21), dias = dentroDe90 ? inteiro(3, 89) : inteiro(95, 420)
  return new Date(base + dias * 86400000).toISOString().slice(0, 10)
}

const usados = new Set(FIXAS.map((f) => f.nome))
const nomeNovo = () => { for (;;) { const n = `${escolhe(PRIMEIROS)} ${escolhe(SEGUNDOS)}`; if (!usados.has(n)) { usados.add(n); return n } } }

export function geraContas() {
  const contas = []
  for (const [segmento, qtd, totalArr, emRisco] of SEGMENTOS) {
    const fixas = FIXAS.filter(() => segmento === 'enterprise'), n = qtd - fixas.length
    // ARR dos demais: lognormal, escalado para o total do segmento
    const brutos = Array.from({ length: n }, () => Math.exp(entre(0, 1.4))), fixoArr = fixas.reduce((a, f) => a + f.arr, 0)
    const k = (totalArr - fixoArr) / brutos.reduce((a, b) => a + b, 0)
    const riscoFixas = fixas.filter((f) => f.saude < 40).length
    for (let i = 0; i < n; i++) {
      const risco = i < emRisco - riscoFixas
      const bruto = Math.round(99 - 56 * Math.pow(rnd(), 3.6) + (rnd() < 0.1 ? 1 : 0)), saude = risco ? inteiro(12, 39) : Math.min(100, bruto >= 96 ? inteiro(86, 100) : bruto) // fora do risco a maioria fica acima de 85; quem passaria de 96 se espalha, para as bolhas não empilharem numa coluna só
      const queda = risco ? -inteiro(8, 28) : rnd() < 0.7 ? 0 : -inteiro(1, 12)
      contas.push({ nome: nomeNovo(), segmento, arr: Math.max(9000, Math.round((brutos[i] * k) / 1000) * 1000), saude: Math.max(saude, risco ? 12 : 41), queda, autonomia: risco && rnd() < 0.25 ? inteiro(1, 3) : null, assentos: risco ? inteiro(25, 68) : inteiro(55, 98), semana: risco ? -inteiro(1, 7) : inteiro(-2, 4), contato: risco ? inteiro(2, 75) : inteiro(1, 40), renovacao: dataRenovacao(rnd() < 0.27), resp: escolhe(RESPONSAVEIS) })
    }
    for (const f of fixas) contas.push({ ...f, segmento, contato: f.contato })
  }
  return contas.map((c) => {
    const comp = c.comp ?? composicao(c.saude), h = historico(c.saude, c.queda)
    return {
      slug: kebab(c.nome), nome: c.nome, segmento: c.segmento, arr: `${c.arr}.00`, saude: c.saude, historico: h, queda: c.saude - Math.max(...h),
      autonomia: c.autonomia ?? null, assentos: c.assentos, semana: c.semana, ultimoContato: c.contato, renovacao: c.renovacao, responsavel: c.resp, composicao: ROTULOS.map((k, i) => ({ k, v: comp[i] })),
    }
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cs = geraContas(), soma = (l) => l.reduce((a, c) => a + Number(c.arr), 0), med = (l) => { const o = l.slice().sort((a, b) => a - b), m = o.length >> 1; return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2 }
  const risco = cs.filter((c) => c.saude < 40), antes = cs.filter((c) => c.historico[8] < 40)
  console.log('contas', cs.length, 'ARR', (soma(cs) / 1e6).toFixed(1), 'M | em risco', risco.length, (soma(risco) / 1e6).toFixed(1), 'M | há 4 sem', antes.length, (soma(antes) / 1e3).toFixed(0), 'k | mediana', med(cs.map((c) => c.saude)), '| renovam 90d', cs.filter((c) => c.renovacao <= '2027-02-19').length)
  console.log('maiores quedas', cs.slice().sort((a, b) => a.queda - b.queda).slice(0, 10).map((c) => `${c.nome} ${c.queda}`).join('; '))
}
