import { registraBase } from '@polaris/engine'
import { registraTemas } from '@polaris/engine/tema'
import { carregaNos } from '../src/nos'
import { configGateway, ErroConfig } from '../src/config'
import { montaGatewayComChave } from '../src/gateway'
import { Registry } from '@polaris/schema'

try {
  const c = configGateway(process.env)
  const reg = new Registry(); registraBase(reg); registraTemas(reg); carregaNos(c.nos, reg)
  const { gw, verifica } = montaGatewayComChave(c, reg)
  await verifica() // a chave de assinatura tem de combinar com a de verificação: senão nenhuma sessão valeria
  await gw.listen({ port: c.porta, host: c.host })
  for (const s of ['SIGTERM', 'SIGINT'] as const) process.once(s, () => { void gw.close().finally(() => process.exit(0)) })
} catch (e) { console.error(e instanceof ErroConfig ? e.message : `falha ao subir o gateway: ${(e as Error).message.split('\n')[0]}`); process.exit(1) }
