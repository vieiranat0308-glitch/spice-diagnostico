# Diagnóstico Spice: Instagram de restaurantes em eventos

Sistema para fazer, na hora, um diagnóstico do Instagram de um restaurante, capturar o lead e gerar a oportunidade para a call de vendas.

## Como funciona

1. **Formulário** (`/`): nome, restaurante, @, WhatsApp, cidade, tipo de negócio, onde vende, maior desafio e autorização de contato (LGPD).
2. **Prints**: de 1 a 3 prints do perfil (topo com bio e destaques, grade de posts). O navegador comprime as imagens antes de enviar.
3. **Análise** (`/api/diagnostico`): o Claude (`claude-opus-5-5`) lê os prints e devolve:
   - nota de 0 a 10 em 4 pilares: **bio, destaques, conteúdo e contexto do negócio** (a nota geral é a média);
   - **3 insights** do perfil;
   - **3 melhorias** com impacto alto ou médio;
   - um bloco **interno**, que o lead não vê: temperatura do lead, serviços da Spice que encaixam, gancho para abrir a call e 3 perguntas de descoberta.
4. **Resultado**: tela com a nota animada e um botão "Quero conversar com a Spice", que marca o lead como interessado e abre o WhatsApp da Spice com uma mensagem pronta.
5. **Painel** (`/painel.html`, protegido por senha): lista de leads com filtros por evento, temperatura e status, funil (novo, contatado, call agendada, proposta, fechado, perdido), observações e exportação para planilha (CSV).

## Links para o evento

| Uso | Link |
|---|---|
| QR code para o lead | `https://SEU-DOMINIO/?evento=Nome%20do%20Evento` |
| Time da Spice abordando | `https://SEU-DOMINIO/?evento=Nome%20do%20Evento&equipe=1` |
| Painel | `https://SEU-DOMINIO/painel.html` |

O parâmetro `evento` separa os leads por evento no painel. No modo equipe, a tela mostra o campo "Quem abordou" (o nome fica salvo no aparelho), não abre o WhatsApp no fim e tem o botão "Novo diagnóstico" para emendar o próximo restaurante.

## Publicar na Vercel

1. Na Vercel: **Add New > Project** e importe este repositório (as configurações padrão já servem).
2. **Storage**: conecte um banco Redis (Upstash) ao projeto. As variáveis `KV_REST_API_URL` e `KV_REST_API_TOKEN` entram sozinhas.
3. **Settings > Environment Variables**:
   - `ANTHROPIC_API_KEY`: chave da API do Claude (console.anthropic.com).
   - `PAINEL_SENHA`: senha do painel de leads.
   - `SPICE_WHATSAPP`: WhatsApp da Spice com DDI e DDD, ex.: `5511999999999`.
4. Faça o deploy e teste com um perfil real antes do evento.

## Custos e limites

- Cada diagnóstico é uma chamada ao Claude com 1 a 3 imagens. Leva em torno de 20 a 40 segundos.
- Há um limite de 20 diagnósticos por hora por IP para proteger a conta. No evento, se todo mundo estiver no mesmo Wi-Fi, todos saem pelo mesmo IP: ajuste `RATE_LIMIT_PER_HOUR` em `api/diagnostico.js` se precisar.
- Os prints **não são armazenados**: só os dados do formulário e o diagnóstico ficam salvos.

## Arquivos

- `index.html`: tela pública (formulário, prints, resultado).
- `painel.html`: painel de leads.
- `api/diagnostico.js`: análise com o Claude e gravação do lead.
- `api/leads.js`: lista e atualiza leads (senha) e registra o "quero conversar" (público).
- `lib/redis.js`: conexão com o Upstash.
