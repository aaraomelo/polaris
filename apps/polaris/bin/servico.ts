import { carregaNos } from '../src/nos'
import { configServico, ErroConfig } from '../src/config'
import { montaServico } from '../src/servico'

try {
  const c = configServico(process.env)
  const reg = carregaNos(c.nos)
  const { app, fecha } = await montaServico(c, reg)
  await app.listen({ port: c.porta, host: c.host })
  for (const s of ['SIGTERM', 'SIGINT'] as const) process.once(s, () => { void fecha().finally(() => process.exit(0)) })
} catch (e) { console.error(e instanceof ErroConfig ? e.message : `falha ao subir o serviço: ${(e as Error).message.split('\n')[0]}`); process.exit(1) }
