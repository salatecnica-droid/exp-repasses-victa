# Repasse Victa · Diagonal ao vivo (Notion → Netlify)

Mesmo funcionamento do site da J.Simões: o site lê a base de projetos do Notion sozinho, e o que mudar no Notion aparece no site em até 5 minutos. Os projetos ficam organizados em pastas, uma por analista, e a Visão geral mostra as entregas das próximas 2 semanas.

## O que tem nesta pasta

- `public/index.html`: o site.
- `public/*.png`, `public/hero.jpg`: logos sem fundo e grafismos da marca EXP.
- `netlify/functions/dados.mjs`: o intermediário que guarda a chave do Notion e entrega só os projetos da Victa e da Diagonal.
- `netlify.toml`: diz ao Netlify onde estão o site e o intermediário.

## Passo 1: Notion

A conexão "Repasse J.Simões" já existe e já tem acesso à base de projetos. Falta só:

1. Abrir a **base de analistas** (a que aparece ao clicar num nome da coluna Analista) e liberar a conexão: `•••` > **Conexões** > "Repasse J.Simões". Sem isso, o site não consegue ler o nome dos analistas.
2. Opcional: no portal de desenvolvedor do Notion, renomear a conexão para algo como "Repasse de projetos", já que agora atende mais de um cliente.

## Passo 2: GitHub

Crie um repositório **privado** chamado `repasse-victa` e envie o conteúdo desta pasta (`public`, `netlify`, `netlify.toml`, `LEIAME.md`) pelo "uploading an existing file", como no da J.Simões.

## Passo 3: Netlify

1. **Add new project** > **Import an existing project** > **GitHub** > `repasse-victa`. As configurações de build já vêm certas.
2. Antes de clicar em Deploy, crie as variáveis em **Add environment variables**:

   | Variável | Valor |
   |---|---|
   | `NOTION_TOKEN` | o mesmo token usado na J.Simões (marque "Contains secret values") |
   | `NOTION_DB_PROJETOS` | `97e40484b9034762b55be582ed88be30` |
   | `CLIENTES_IDS` | `Victa=a3d9526f0d3844058dfd7983fee0ae22;Diagonal=2073f66aa01f8094a1e2e7da6602f4a3` |

3. Clique em **Deploy**. Para o link ficar mais amigável, troque o nome do projeto (ex.: `exp-repasse-victa`).

## Como saber se está funcionando

O rodapé da barra lateral mostra **"Conectado ao Notion"**. Para conferir detalhes, abra `seu-site.netlify.app/api/dados` e procure `avisos`: colchetes vazios significam que está tudo certo.

## Regras de preenchimento no Notion

- O projeto (linha COOR) precisa ter o cliente Victa ou Diagonal na coluna **CLIENTES** e o analista na coluna **Analista**. Projeto sem analista aparece numa pasta "Sem analista".
- O nome mostrado no site é o que está entre colchetes no título (ex.: `260122 - Victa [Parquelândia]` vira "Parquelândia"). O código interno não aparece.
- As disciplinas são subitens da linha COOR. As entregas das próximas 2 semanas saem da coluna **Próxima Entrega** das disciplinas que ainda não foram postadas.
- Legalização, checklist de pendências por etapa e status seguem as mesmas regras do site da J.Simões.
- Para tirar um projeto do site, marque o Status como **ARQUIVADO**.

## Adicionar outro cliente no mesmo site

Acrescente em `CLIENTES_IDS` mais um trecho `;Nome=link-da-página-do-cliente` e faça um novo deploy (Deploys > Trigger deploy).
