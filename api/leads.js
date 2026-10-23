import { getRedis, LEAD_IDS_KEY, leadKey } from '../lib/redis.js';

const STATUS = ['novo', 'contatado', 'call_agendada', 'proposta', 'fechado', 'perdido'];

function autorizado(req) {
  const senha = process.env.PAINEL_SENHA;
  return Boolean(senha) && req.headers['x-painel-senha'] === senha;
}

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) {
    return res.status(500).json({
      error: 'Banco de dados não conectado. Na Vercel, vá em Storage e conecte um banco Redis (Upstash) a este projeto.'
    });
  }

  // Ação pública: o próprio lead clica em "quero conversar" na tela de resultado.
  if (req.method === 'POST' && req.body?.acao === 'quer_conversar') {
    const id = String(req.body.id || '');
    const lead = id && await redis.get(leadKey(id));
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });
    if (!lead.quer_conversar) {
      lead.quer_conversar = true;
      lead.quer_conversar_em = new Date().toISOString();
      await redis.set(leadKey(id), lead);
    }
    return res.status(200).json({ ok: true });
  }

  if (!autorizado(req)) {
    return res.status(401).json({ error: 'Senha do painel incorreta' });
  }

  try {
    if (req.method === 'GET') {
      const ids = await redis.lrange(LEAD_IDS_KEY, 0, 999);
      if (!ids.length) return res.status(200).json([]);
      const leads = await redis.mget(...ids.map(leadKey));
      return res.status(200).json(leads.filter(Boolean));
    }

    if (req.method === 'PATCH') {
      const { id, status, observacoes } = req.body || {};
      const lead = id && await redis.get(leadKey(String(id)));
      if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });
      if (status !== undefined) {
        if (!STATUS.includes(status)) return res.status(400).json({ error: 'Status inválido' });
        lead.status = status;
      }
      if (observacoes !== undefined) lead.observacoes = String(observacoes).slice(0, 2000);
      await redis.set(leadKey(lead.id), lead);
      return res.status(200).json(lead);
    }

    res.setHeader('Allow', 'GET, PATCH, POST');
    return res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
