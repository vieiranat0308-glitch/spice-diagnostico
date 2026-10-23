import Anthropic from '@anthropic-ai/sdk';
import { getRedis, LEAD_IDS_KEY, leadKey } from '../lib/redis.js';

const MODEL = 'claude-opus-5-5';
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 1_500_000; // por imagem, já comprimida no navegador
const RATE_LIMIT_PER_HOUR = 20; // por IP, protege o custo da API

const pilar = {
  type: 'object',
  properties: {
    nota: { type: 'integer', description: 'Nota de 0 a 10' },
    comentario: { type: 'string', description: 'Uma frase curta e específica sobre o que foi visto' }
  },
  required: ['nota', 'comentario'],
  additionalProperties: false
};

const textoComTitulo = {
  type: 'object',
  properties: {
    titulo: { type: 'string' },
    texto: { type: 'string' }
  },
  required: ['titulo', 'texto'],
  additionalProperties: false
};

const SCHEMA = {
  type: 'object',
  properties: {
    perfil_legivel: {
      type: 'boolean',
      description: 'false se os prints não mostram um perfil de Instagram legível'
    },
    dados_perfil: {
      type: 'object',
      properties: {
        seguidores: { type: 'string', description: 'Como aparece no print, ex: "12,4 mil". Vazio se não visível.' },
        posts: { type: 'string' },
        destaques_visiveis: { type: 'array', items: { type: 'string' } }
      },
      required: ['seguidores', 'posts', 'destaques_visiveis'],
      additionalProperties: false
    },
    pilares: {
      type: 'object',
      properties: {
        bio: pilar,
        destaques: pilar,
        conteudo: pilar,
        contexto_negocio: pilar
      },
      required: ['bio', 'destaques', 'conteudo', 'contexto_negocio'],
      additionalProperties: false
    },
    resumo: { type: 'string', description: 'Uma frase de veredito, direta, para o dono do restaurante' },
    insights: { type: 'array', items: textoComTitulo, description: 'Exatamente 3 insights' },
    melhorias: {
      type: 'array',
      description: 'Exatamente 3 melhorias, da mais urgente para a menos urgente',
      items: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          texto: { type: 'string' },
          impacto: { type: 'string', enum: ['alto', 'medio'] }
        },
        required: ['titulo', 'texto', 'impacto'],
        additionalProperties: false
      }
    },
    interno: {
      type: 'object',
      description: 'Uso interno da Spice, NUNCA mostrado ao lead',
      properties: {
        temperatura: { type: 'string', enum: ['quente', 'morno', 'frio'] },
        servicos_recomendados: { type: 'array', items: { type: 'string' } },
        gancho_call: { type: 'string', description: 'Como abrir a call de vendas em 1 ou 2 frases' },
        perguntas_call: { type: 'array', items: { type: 'string' }, description: '3 perguntas para a call' }
      },
      required: ['temperatura', 'servicos_recomendados', 'gancho_call', 'perguntas_call'],
      additionalProperties: false
    }
  },
  required: ['perfil_legivel', 'dados_perfil', 'pilares', 'resumo', 'insights', 'melhorias', 'interno'],
  additionalProperties: false
};

const SYSTEM = `Você é estrategista sênior da Spice Marketing, agência especializada só em food service (restaurantes, bares, hamburguerias, pizzarias, cafeterias, confeitarias, delivery). Você está num evento fazendo um diagnóstico relâmpago do Instagram de um restaurante a partir de prints do perfil.

Avalie 4 pilares, nota inteira de 0 a 10, com honestidade (a maioria dos perfis fica entre 4 e 7; 9 ou 10 só para perfis realmente exemplares):

1. bio: clareza do que é o negócio, localização, horário ou forma de pedir, CTA, link (cardápio, delivery, reserva, WhatsApp), nome pesquisável.
2. destaques: existem, têm capas padronizadas, cobrem o que o cliente procura (cardápio, como pedir, localização, avaliações, bastidores, eventos).
3. conteudo: qualidade e apetite das fotos, consistência visual da grade, variedade (prato, ambiente, pessoas, bastidores), presença de Reels, rostos e storytelling, frequência aparente.
4. contexto_negocio: o quanto o perfil comunica e serve o modelo de negócio informado (salão, delivery, encomenda, eventos), o diferencial e o ticket, e se conduz o seguidor até a compra.

Regras:
- Baseie-se só no que está visível nos prints e nas informações do formulário. Não invente números; se algo não aparece, diga que não deu para ver.
- Seja específico ao perfil: cite o que você viu ("a bio não diz o bairro", "os destaques não têm cardápio"). Nada de conselho genérico.
- Insights: 3 leituras sobre o perfil, mistura de pontos fortes e alertas, cada uma com título curto (até 6 palavras) e texto de até 2 frases.
- Melhorias: 3 ações práticas que o dono entende e consegue imaginar, da mais urgente para a menos. Ao menos uma deve mostrar que existe ganho maior com estratégia profissional (calendário sazonal, tráfego pago local, produção de conteúdo), sem soar como propaganda.
- Tom: português brasileiro, direto, caloroso, sem jargão de agência, sem travessões, sem emojis.
- Se os prints não forem de um perfil de Instagram legível, marque perfil_legivel = false e preencha o resto de forma mínima.
- Bloco interno: avalie a temperatura do lead para a venda (quente = dor clara e potencial de investimento; frio = perfil muito pequeno ou sem dor), sugira serviços da Spice (Gestão de Redes, Produção de Conteúdo, Calendário Sazonal, Tráfego Pago Local, Identidade Visual, Consultoria Editorial), um gancho para abrir a call e 3 perguntas de descoberta.`;

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : (fwd || '')).split(',')[0].trim() || 'desconhecido';
}

function cleanText(v, max = 200) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function parseImage(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) return null;
  if (m[2].length * 0.75 > MAX_IMAGE_BYTES) return null;
  return { media_type: m[1], data: m[2] };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const body = req.body || {};
  const lead = {
    nome: cleanText(body.nome, 80),
    restaurante: cleanText(body.restaurante, 120),
    instagram: cleanText(body.instagram, 60).replace(/^@+/, '').replace(/^.*instagram\.com\//, '').replace(/[/?].*$/, ''),
    whatsapp: cleanText(body.whatsapp, 30),
    cidade: cleanText(body.cidade, 80),
    tipo: cleanText(body.tipo, 60),
    canais: Array.isArray(body.canais) ? body.canais.map((c) => cleanText(c, 40)).filter(Boolean).slice(0, 6) : [],
    desafio: cleanText(body.desafio, 120),
    evento: cleanText(body.evento, 80),
    responsavel: cleanText(body.responsavel, 60),
    origem: body.origem === 'equipe' ? 'equipe' : 'qrcode'
  };

  if (!lead.nome || !lead.restaurante || !lead.instagram || !lead.whatsapp) {
    return res.status(400).json({ error: 'Preencha nome, restaurante, Instagram e WhatsApp.' });
  }
  if (!body.consentimento) {
    return res.status(400).json({ error: 'É preciso aceitar o contato da Spice para gerar o diagnóstico.' });
  }

  const images = (Array.isArray(body.imagens) ? body.imagens : []).slice(0, MAX_IMAGES).map(parseImage);
  if (!images.length || images.some((i) => !i)) {
    return res.status(400).json({ error: 'Envie de 1 a 4 prints do perfil (JPG, PNG ou WEBP).' });
  }

  const redis = getRedis();
  if (redis) {
    const rlKey = `spice:rl:${clientIp(req)}:${new Date().toISOString().slice(0, 13)}`;
    const count = await redis.incr(rlKey);
    if (count === 1) await redis.expire(rlKey, 3600);
    if (count > RATE_LIMIT_PER_HOUR) {
      return res.status(429).json({ error: 'Muitos diagnósticos seguidos. Tente de novo em alguns minutos.' });
    }
  }

  const contexto = [
    `Restaurante: ${lead.restaurante}`,
    `Instagram: @${lead.instagram}`,
    lead.cidade && `Cidade: ${lead.cidade}`,
    lead.tipo && `Tipo de negócio: ${lead.tipo}`,
    lead.canais.length && `Onde vende: ${lead.canais.join(', ')}`,
    lead.desafio && `Maior desafio declarado pelo dono: ${lead.desafio}`
  ].filter(Boolean).join('\n');

  const client = new Anthropic();
  let message;
  try {
    message = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: SCHEMA }
      },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          ...images.map((img) => ({ type: 'image', source: { type: 'base64', ...img } })),
          { type: 'text', text: `Dados informados no formulário:\n${contexto}\n\nFaça o diagnóstico do perfil a partir dos prints acima.` }
        ]
      }]
    });
  } catch (err) {
    console.error('Erro na API do Claude:', err);
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(503).json({ error: 'Muita gente usando agora. Tente de novo em 1 minuto.' });
    }
    return res.status(502).json({ error: 'Não conseguimos analisar agora. Tente de novo.' });
  }

  if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') {
    console.error('Resposta incompleta:', message.stop_reason, message.stop_details);
    return res.status(502).json({ error: 'Não conseguimos analisar esses prints. Tente outros.' });
  }

  let diag;
  try {
    const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    diag = JSON.parse(text);
  } catch (err) {
    console.error('JSON inválido do modelo:', err);
    return res.status(502).json({ error: 'A análise veio incompleta. Tente de novo.' });
  }

  if (!diag.perfil_legivel) {
    return res.status(422).json({
      error: 'Não conseguimos ler o perfil nesses prints. Tire um print do topo do perfil (bio e destaques) e outro da grade de posts.'
    });
  }

  const notas = Object.values(diag.pilares).map((p) => Math.max(0, Math.min(10, p.nota)));
  const notaGeral = Math.round((notas.reduce((a, b) => a + b, 0) / notas.length) * 10) / 10;

  const publico = {
    nota_geral: notaGeral,
    resumo: diag.resumo,
    pilares: diag.pilares,
    insights: diag.insights.slice(0, 3),
    melhorias: diag.melhorias.slice(0, 3),
    dados_perfil: diag.dados_perfil
  };

  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const registro = {
    id,
    criado_em: new Date().toISOString(),
    status: 'novo',
    quer_conversar: false,
    observacoes: '',
    lead,
    diagnostico: publico,
    interno: diag.interno
  };

  if (redis) {
    try {
      await redis.set(leadKey(id), registro);
      await redis.lpush(LEAD_IDS_KEY, id);
    } catch (err) {
      console.error('Falha ao salvar lead:', err);
    }
  } else {
    console.warn('Redis não configurado: lead não foi salvo.', JSON.stringify(registro));
  }

  return res.status(200).json({
    id,
    diagnostico: publico,
    whatsapp_spice: (process.env.SPICE_WHATSAPP || '').replace(/\D/g, '')
  });
}
