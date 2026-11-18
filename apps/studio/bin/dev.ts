import { PGlite } from '@electric-sql/pglite'
import { registraBase } from '@polaris/engine'
import { registraTemas } from '@polaris/engine/tema'
import { DDL_DIRETORIO, criaArmazemDeNos, diretorioSql, registroDaPlataforma } from '@polaris/packs'
import { criaServidorStudio } from '../src/servidor'

// Studio local: banco em memória (PGlite), um tenant de demonstração e UM usuário de desenvolvimento com todas as permissões. Só escuta em 127.0.0.1 e RECUSA rodar em produção.
if (process.env.NODE_ENV === 'production') throw new Error('o servidor de desenvolvimento do Studio não roda em produção (a autenticação aqui é um stub)')
const TENANT = '11111111-1111-1111-1111-111111111111', USUARIO = process.env.STUDIO_USUARIO ?? 'dev'
const pg = new PGlite(); await pg.exec(DDL_DIRETORIO)
const q = async (s: string, p: unknown[] = []) => { const r = await pg.query(s, p); return { rows: r.rows as Array<Record<string, unknown>>, rowCount: r.affectedRows ?? r.rows.length } }
await diretorioSql(q).cria({ tenantId: TENANT, alias: 'demo', nome: 'Demo', segmento: 'varejo', packs: ['varejo'], donoEmail: 'demo@exemplo.com', chave: 'chave-dev-studio-0000000000' })
const base = registroDaPlataforma(); registraBase(base); registraTemas(base)
const armazem = criaArmazemDeNos({ q, base })
await armazem.salva(TENANT, USUARIO, { kind: 'pagina', id: 'home', versao: '1.0.0', estatuto: 'publicado', spec: { rota: '/', titulo: 'Início', raiz: { bloco: 'layout/pilha', id: 'raiz', props: { gap: 12 }, slots: { filhos: [{ bloco: 'texto/titulo', id: 'titulo', props: { texto: 'Bem-vindo', nivel: 1 } }, { bloco: 'texto/paragrafo', id: 'texto', props: { texto: 'Edite esta página no Studio.' } }] } } } }, 'exemplo')
const app = criaServidorStudio({ armazem, baseDe: async () => base, q, autentica: async () => ({ tenantId: TENANT, usuario: USUARIO, pode: () => true }) })
const porta = Number(process.env.PORT ?? 4300); await app.listen({ host: '127.0.0.1', port: porta })
console.log(`Studio em http://127.0.0.1:${porta}/studio (usuário "${USUARIO}", banco em memória)`)
