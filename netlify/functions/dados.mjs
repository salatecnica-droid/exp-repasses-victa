// Lê a base de projetos do Notion e devolve só os dados do repasse Victa / Diagonal em JSON.
// A chave do Notion fica nas variáveis de ambiente do Netlify e nunca chega ao navegador.
//
// Variáveis de ambiente (Netlify > Project configuration > Environment variables):
//   NOTION_TOKEN        chave da integração (começa com "ntn_" ou "secret_")
//   NOTION_DB_PROJETOS  link ou ID da base de projetos (a base original, não a visualização)
//   NOTION_DB_LEGAL     (opcional) link da base de legalização; vazio ou igual à de projetos = mesma base
//   CLIENTES_IDS        os clientes do repasse, no formato  Nome=link;Nome=link
//                       ex.: Victa=https://app.notion.com/p/…?p=a3d9…;Diagonal=https://app.notion.com/p/…?p=2073…

// Nomes das colunas no Notion. Se alguém renomear uma coluna lá, ajuste aqui.
const COLUNAS = {
  clientes: "CLIENTES",
  analista: "Analista",
  status: "Status",
  disciplina: "Disciplina",
  etapa: "Etapa",
  statusAtual: "Status Atual",
  entrega: "Próxima Entrega",
  pendencias: "Pendências para Próx. Etapa",
  legalStatus: "Status Legal",
  legalPrazo: "Prazo",
  legalRetorno: "Previsão de retorno",
  legalDisciplina: "Disciplina",
};
// Mesmas regras de filtro da visualização JSIMÕES no Notion
const STATUS_EXCLUIDO = "ARQUIVADO";
const LEGAL_SIGLAS = ["INC", "ELE", "SBE"]; // disciplinas que têm legalização
const DISCIPLINA_EXCLUIDA = "CRON";
const FUSO = "America/Sao_Paulo"; // para calcular "hoje" nas próximas entregas
// Checklist por etapa: caixas de seleção do projeto com o nome "EP - Arquitetura", "PB - Estrutural"...
// Caixas sem esse prefixo (ex.: "Plano de trabalho", que é interno) ficam de fora
const CHECKLIST_PREFIXO = /^\s*(EP|AP|PL|PB|EX|PE)\s*[-–—]\s*(.+?)\s*$/i;

const API = process.env.NOTION_API_BASE || "https://api.notion.com";
const VERSAO = "2025-09-03";
const CACHE_SEGUNDOS = 300;

const env = (k) => (process.env[k] || "").trim();
// Aceita link do Notion ou ID puro e devolve o ID com hífens
function idDe(texto) {
  // Link de página aberta "por cima" (…?p=ID) aponta para a página do parâmetro p
  const t = String(texto || "").replace(/-/g, "");
  const m = t.match(/[?&]p=([0-9a-f]{32})/i)?.slice(1) || t.match(/[0-9a-f]{32}/i);
  if (!m) return null;
  const h = m[0].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function notion(caminho, metodo = "GET", corpo) {
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const r = await fetch(API + caminho, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${env("NOTION_TOKEN")}`,
        "Notion-Version": VERSAO,
        "Content-Type": "application/json",
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    if (r.status === 429) { // limite de acessos do Notion: espera e tenta de novo
      const espera = Number(r.headers.get("retry-after") || 1);
      await new Promise((ok) => setTimeout(ok, espera * 1000));
      continue;
    }
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(json.message || `Notion respondeu ${r.status}`);
      e.status = r.status; e.code = json.code;
      throw e;
    }
    return json;
  }
  throw new Error("Notion ocupado (muitas tentativas)");
}

// Uma "base" do Notion pode ter mais de uma fonte de dados; usamos a primeira
async function fonteDe(dbId) {
  const db = await notion(`/v1/databases/${dbId}`);
  const ds = db.data_sources && db.data_sources[0];
  if (!ds) throw new Error("A base não tem fonte de dados");
  return notion(`/v1/data_sources/${ds.id}`);
}

async function consultar(fonteId, filtro) {
  const paginas = [];
  let cursor;
  do {
    const corpo = { page_size: 100, filter: filtro };
    if (cursor) corpo.start_cursor = cursor;
    const r = await notion(`/v1/data_sources/${fonteId}/query`, "POST", corpo);
    paginas.push(...r.results);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return paginas;
}

// Transforma qualquer tipo de propriedade do Notion em texto, lista ou data simples
function valor(p) {
  if (!p) return null;
  switch (p.type) {
    case "title": case "rich_text":
      return (p[p.type] || []).map((t) => t.plain_text).join("").trim() || null;
    case "select": case "status":
      return p[p.type] ? p[p.type].name : null;
    case "multi_select":
      return p.multi_select.map((o) => o.name);
    case "date":
      return p.date ? p.date.start.slice(0, 10) : null;
    case "number": return p.number;
    case "checkbox": return p.checkbox;
    case "relation": return p.relation.map((r) => r.id);
    case "people": return p.people.map((u) => u.name).filter(Boolean);
    case "unique_id": return p.unique_id ? `${p.unique_id.prefix || ""}${p.unique_id.number}` : null;
    case "formula": {
      const f = p.formula;
      if (!f) return null;
      if (f.type === "date") return f.date ? f.date.start.slice(0, 10) : null;
      return f[f.type] ?? null;
    }
    case "rollup": {
      const r = p.rollup;
      if (!r) return null;
      if (r.type === "array") return r.array.map(valor).flat().filter((v) => v != null && v !== "");
      if (r.type === "date") return r.date ? r.date.start.slice(0, 10) : null;
      return r[r.type] ?? null;
    }
    default: return null;
  }
}
const texto = (v) => (Array.isArray(v) ? v.join(", ") : v == null ? null : String(v).trim() || null);
const lista = (v) => (v == null ? [] : (Array.isArray(v) ? v : [v]).map(String).filter(Boolean));
const prop = (pg, nome) => valor(pg.properties[nome]);
const titulo = (pg) => {
  const p = Object.values(pg.properties).find((x) => x.type === "title");
  return valor(p) || "";
};
const codigoDe = (t) => (String(t).match(/^\s*(\d{4,6})/) || [])[1] || null;

// Lê as caixas de seleção do checklist (marcada = concluída)
function checklistDe(pg) {
  const itens = [];
  for (const [nome, p] of Object.entries(pg.properties)) {
    if (p.type !== "checkbox") continue;
    const m = nome.match(CHECKLIST_PREFIXO);
    if (m) itens.push({ etapa: m[1].toUpperCase(), item: m[2], ok: p.checkbox });
  }
  return itens;
}

// Monta um filtro de "diferente de" / "não vazio" respeitando o tipo da coluna
function filtroTexto(esquema, nome, cond) {
  const p = esquema.properties[nome];
  if (!p) throw new Error(`Coluna "${nome}" não encontrada na base`);
  return { property: nome, [p.type]: cond };
}

export default async () => {
  const faltando = ["NOTION_TOKEN", "NOTION_DB_PROJETOS", "CLIENTES_IDS"].filter((k) => !env(k));
  if (faltando.length) {
    return Response.json({ erro: `Configuração incompleta no Netlify: ${faltando.join(", ")}` }, { status: 503 });
  }
  try {
    const avisos = [];
    const idProj = idDe(env("NOTION_DB_PROJETOS")), idLegal = idDe(env("NOTION_DB_LEGAL"));
    const mesmaBase = !idLegal || idLegal === idProj; // legalização nas próprias linhas de disciplina
    const esqProj = await fonteDe(idProj);
    const esqLegal = mesmaBase ? esqProj : await fonteDe(idLegal);

    // 1) Projetos e disciplinas da J.Simões
    const regras = [
      filtroTexto(esqProj, COLUNAS.status, { does_not_equal: STATUS_EXCLUIDO }),
      filtroTexto(esqProj, COLUNAS.disciplina, { does_not_equal: DISCIPLINA_EXCLUIDA }),
      filtroTexto(esqProj, COLUNAS.disciplina, { is_not_empty: true }),
    ];
    // Clientes: "Victa=link;Diagonal=link" → [{nome, id}]
    const clientes = env("CLIENTES_IDS").split(/[;\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
      const i = x.indexOf("="); return { nome: x.slice(0, i).trim(), id: idDe(x.slice(i + 1)) };
    }).filter((c) => c.nome && c.id);
    if (!clientes.length) throw new Error("Configuração incompleta no Netlify: CLIENTES_IDS (ex.: Victa=link;Diagonal=link)");
    // Coluna de clientes: usa "CLIENTES" se existir; senão procura uma relação com "client" no nome
    const props = esqProj.properties;
    if (!props[COLUNAS.clientes]) {
      const achada = Object.keys(props).find((n) => props[n].type === "relation" && /client/i.test(n));
      if (achada) COLUNAS.clientes = achada;
    }
    const tituloNome = Object.keys(props).find((n) => props[n].type === "title");
    const porTitulo = { or: clientes.map((c) => ({ property: tituloNome, title: { contains: c.nome } })) };
    let linhas = [];
    if (props[COLUNAS.clientes]?.type === "relation") {
      const porCliente = { or: clientes.map((c) => ({ property: COLUNAS.clientes, relation: { contains: c.id } })) };
      linhas = await consultar(esqProj.id, { and: [porCliente, ...regras] });
      if (!linhas.length) avisos.push("Os links de CLIENTES_IDS não encontraram projetos; filtrando pelo nome do cliente no título.");
    } else {
      avisos.push(`A base não tem a coluna "${COLUNAS.clientes}": filtrando pelo nome do cliente no título (${clientes.map((c) => c.nome).join(", ")}).`);
    }
    if (!linhas.length) linhas = await consultar(esqProj.id, { and: [porTitulo, ...regras] });
    if (!linhas.length) avisos.push("Nenhuma linha encontrada para os clientes de CLIENTES_IDS. Confira os nomes e links.");

    const ehCoor = (pg) => String(prop(pg, COLUNAS.disciplina) || "").toUpperCase() === "COOR";
    const projetos = new Map();
    for (const pg of linhas.filter(ehCoor)) {
      const t = titulo(pg);
      const m = t.match(/\[(.+?)\]/); // "260122 - Victa [Parquelândia]" → Parquelândia
      const ids = (pg.properties[COLUNAS.clientes]?.relation || []).map((r) => r.id);
      const cli = clientes.find((c) => ids.includes(c.id)) || clientes.find((c) => t.toLowerCase().includes(c.nome.toLowerCase()));
      projetos.set(pg.id, {
        id: pg.id,
        titulo: t,
        codigo: codigoDe(t),
        js: null, // a Victa não tem código próprio; o código interno fica escondido
        nome: m ? m[1].trim() : t,
        cliente: cli ? cli.nome : null,
        analistaIds: pg.properties[COLUNAS.analista]?.type === "relation" ? pg.properties[COLUNAS.analista].relation.map((r) => r.id) : [],
        analistaTexto: pg.properties[COLUNAS.analista]?.type !== "relation" ? texto(prop(pg, COLUNAS.analista)) : null,
        etapa: texto(prop(pg, COLUNAS.etapa)),
        status: texto(prop(pg, COLUNAS.statusAtual)),
        entrega: texto(prop(pg, COLUNAS.entrega)),
        pendencias: lista(prop(pg, COLUNAS.pendencias)),
        requisitos: checklistDe(pg),
        disciplinas: [],
        legal: [],
      });
    }
    const porCodigo = new Map([...projetos.values()].map((p) => [p.codigo, p]));
    // Disciplina pertence ao projeto pelo subitem (relação) ou, se não houver, pelo código no título
    const donoDe = (pg) => {
      for (const p of Object.values(pg.properties)) {
        if (p.type === "relation") for (const r of p.relation) if (projetos.has(r.id)) return projetos.get(r.id);
      }
      return porCodigo.get(codigoDe(titulo(pg)));
    };
    for (const pg of linhas.filter((x) => !ehCoor(x))) {
      const dono = donoDe(pg);
      if (!dono) { avisos.push(`Disciplina sem projeto: ${titulo(pg)}`); continue; }
      const sigla = texto(prop(pg, COLUNAS.disciplina));
      dono.disciplinas.push({
        sigla,
        etapa: texto(prop(pg, COLUNAS.etapa)),
        status: texto(prop(pg, COLUNAS.statusAtual)),
        entrega: texto(prop(pg, COLUNAS.entrega)),
      });
      // Mesma base: Incêndio, Elétrico e SBE trazem a legalização na própria linha
      const statusLegal = mesmaBase ? texto(prop(pg, COLUNAS.legalStatus)) : null;
      if (statusLegal && LEGAL_SIGLAS.includes(String(sigla).toUpperCase())) {
        dono.legal.push({ sigla, status: statusLegal, prazo: texto(prop(pg, COLUNAS.legalPrazo)), retorno: texto(prop(pg, COLUNAS.legalRetorno)) });
      }
    }

    // 2) Legalização: só as linhas ligadas a esses projetos
    if (mesmaBase && !esqProj.properties[COLUNAS.legalStatus]) avisos.push(`Coluna "${COLUNAS.legalStatus}" não encontrada na base.`);
    if (projetos.size && !mesmaBase) {
      const tituloLegal = Object.keys(esqLegal.properties).find((k) => esqLegal.properties[k].type === "title");
      const ou = [...porCodigo.keys()].filter(Boolean).map((c) => ({ property: tituloLegal, title: { starts_with: c } }));
      const legais = await consultar(esqLegal.id, { or: ou });
      for (const pg of legais) {
        const dono = donoDe(pg);
        if (!dono) continue;
        dono.legal.push({
          sigla: texto(prop(pg, COLUNAS.legalDisciplina)),
          status: texto(prop(pg, COLUNAS.legalStatus)),
          prazo: texto(prop(pg, COLUNAS.legalPrazo)),
          retorno: texto(prop(pg, COLUNAS.legalRetorno)),
        });
      }
    }

    // Lista completa de pendências possíveis = opções do campo de múltipla seleção, na ordem do Notion
    const campoPend = esqProj.properties[COLUNAS.pendencias];
    const opcoesPendencias = campoPend && campoPend.type === "multi_select"
      ? (campoPend.multi_select?.options || []).map((o) => o.name)
      : null;

    // Analistas: nome de cada página ligada na coluna Analista (a conexão precisa ter acesso à base de analistas)
    const slugNome = (n) => String(n).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const nomes = new Map();
    const idsAnalistas = [...new Set([...projetos.values()].flatMap((p) => p.analistaIds))];
    let semAcesso = 0;
    await Promise.all(idsAnalistas.map(async (id) => {
      try { const pg = await notion(`/v1/pages/${id}`); nomes.set(id, titulo(pg) || "Analista"); }
      catch { semAcesso++; nomes.set(id, null); }
    }));
    if (semAcesso) avisos.push(`Sem acesso a ${semAcesso} página(s) de analista. Adicione a conexão à base de analistas no Notion (••• > Conexões).`);
    const analistas = new Map();
    for (const p of projetos.values()) {
      const nome = p.analistaIds.map((id) => nomes.get(id)).find(Boolean) || p.analistaTexto || (p.analistaIds.length ? "Analista" : "Sem analista");
      const id = slugNome(nome) || "sem-analista";
      analistas.set(id, { id, nome });
      p.analista = id;
      delete p.analistaIds; delete p.analistaTexto;
    }

    const corpo = {
      fonte: "notion",
      atualizado: new Date().toISOString(),
      hoje: new Date().toLocaleDateString("en-CA", { timeZone: FUSO }),
      clientes: clientes.map((c) => c.nome),
      analistas: [...analistas.values()].sort((a, b) => a.nome.localeCompare(b.nome)),
      opcoesPendencias,
      projetos: [...projetos.values()],
      avisos,
    };
    return Response.json(corpo, {
      headers: {
        // O navegador sempre pergunta; o Netlify guarda a resposta por 5 minutos
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Netlify-CDN-Cache-Control": `public, durable, s-maxage=${CACHE_SEGUNDOS}, stale-while-revalidate=${CACHE_SEGUNDOS}`,
      },
    });
  } catch (e) {
    const dica = e.status === 401 ? "A chave do Notion (NOTION_TOKEN) é inválida."
      : e.status === 404 || e.code === "object_not_found" ? "A integração não tem acesso a alguma das bases. No Notion, abra cada base e adicione a integração em ••• > Conexões."
      : e.message.replace(/^Configuração/, "Configuração");
    return Response.json({ erro: dica }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
};

export const config = { path: "/api/dados" };
