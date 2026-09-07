import type { CanalIdentidade, Identidade, SinaisContato } from "@/tipos";

/**
 * Quem é essa pessoa, sem depender do telefone.
 *
 * O problema real: a mesma pessoa manda DM no Instagram como `@ju.mendes.sp`,
 * depois chama no WhatsApp com o perfil escrito "Ju 💛" e nenhum dos dois
 * carrega telefone comparável — o Instagram nem entrega telefone, e o nome do
 * perfil raramente é o nome civil. Casar por nome é ilusão: existem três
 * "Ana Silva" no estoque de qualquer imobiliária.
 *
 * A saída é aceitar que existem dois tipos de certeza e tratá-los diferente:
 *
 * 1. **Determinística** — uma chave que só pode ser de uma pessoa: CPF,
 *    e-mail, ou o próprio identificador do canal já visto antes. Casa sozinha.
 * 2. **Declarada** — a própria pessoa diz ("sim, sou eu que falei pelo
 *    Insta"). É o sinal mais forte que existe fora de documento, porque é
 *    primeira mão e voluntário. Casa sozinha.
 * 3. **Probabilística** — soma de indícios: mesmo @ em canais diferentes,
 *    mesmo imóvel citado na mesma semana, mesma busca. **Nunca casa sozinha.**
 *
 * A regra que fecha o desenho: *fundir errado é pior que duplicar*. Duplicar
 * gera trabalho repetido; fundir errado mostra a negociação de uma pessoa
 * para outra. Por isso o palpite vira pedido de fusão pra alguém olhar, e não
 * escrita no banco.
 */

/** Peso de cada indício. Somados, viram uma faixa de confiança. */
export const PESOS = {
  /** Chave fiscal. Não existe coincidência aqui. */
  cpf: 100,
  /** E-mail idêntico. Compartilhado em família às vezes, mas raro. */
  email: 70,
  /**
   * O mesmo @ em canais diferentes. Quem usa `ju.mendes.sp` no Instagram
   * costuma repetir no perfil do WhatsApp e no cadastro do site.
   *
   * Vale exatamente o limite da sugestão, e isso é a regra inteira em um
   * número: apelido igual em outro canal **sempre** dá pra perguntar, e
   * **nunca** dá pra fundir sozinho. É o sinal que ocupa o lugar do telefone
   * quando o canal não entrega telefone nenhum.
   */
  handle: 60,
  /** O handle de um canal aparece escrito no apelido do outro. */
  handleNoApelido: 30,
  /** Mesmo imóvel citado dentro da janela. Sozinho não diz nada — dois
   *  interessados no mesmo anúncio é o normal, não a exceção. */
  mesmoImovel: 25,
  /** Busca compatível: mesmo tipo, bairro em comum e faixa de preço que se
   *  sobrepõe. Duas pessoas procurando a mesma coisa também é comum. */
  buscaCompativel: 20,
  /** Nome normalizado igual. O mais fraco de todos, de propósito. */
  nome: 15,
} as const;

/** A partir daqui vale perguntar pra alguém. Abaixo, é ruído. */
export const LIMITE_SUGESTAO = 60;

/** Janela em que "citou o mesmo imóvel" ainda é indício de ser a mesma pessoa. */
export const JANELA_DIAS = 7;

/** Tira acento, caixa, @, pontuação e espaço duplo. */
export function normalizar(texto: string | null | undefined): string {
  if (!texto) return "";
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9._\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reduz um handle ao seu miolo: `ju.mendes.sp` e `ju_mendes` viram `jumendes`
 * (o sufixo de duas letras é quase sempre estado ou ano, não identidade).
 */
export function miolo(handle: string): string {
  const base = normalizar(handle).replace(/[._\s]/g, "");
  return base.replace(/(sp|rj|mg|oficial|\d{2,4})$/, "") || base;
}

/**
 * CPF/CNPJ comparável: só os dígitos. `123.456.789-00` e `12345678900` são o
 * mesmo documento, e a normalização geral não serve aqui porque ela preserva
 * ponto (que em handle é significativo e em CPF é enfeite).
 */
export const soDigitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/**
 * Todos os apelidos que um contato carrega, reduzidos ao miolo.
 *
 * Existe porque **o sinal muda de campo conforme o canal**. No Instagram o
 * apelido está no identificador (`@ju.mendes.sp`); no WhatsApp o identificador
 * é um número e o apelido está no nome do perfil ("Ju Mendes"). Comparar só
 * identificador com identificador nunca acharia a mesma pessoa — que é
 * exatamente o problema de casar sem telefone.
 */
export function nucleos(s: {
  identificador?: string;
  apelido?: string | null;
  nome?: string | null;
}): string[] {
  const saida: string[] = [];

  // O identificador do canal sempre conta: é único na plataforma e foi
  // escolhido pela pessoa.
  const doId = miolo(s.identificador ?? "");
  if (doId.length >= 5) saida.push(doId);

  // Nome de exibição só conta se for COMPOSTO. "Ju Mendes" identifica;
  // "Roberto" não — e sem esta regra o sistema sugere fundir dois homônimos
  // que nunca se viram, que é o erro mais caro que ele pode cometer.
  for (const texto of [s.apelido, s.nome]) {
    if (!texto) continue;
    const partes = normalizar(texto).split(/[\s._]+/).filter(Boolean);
    if (partes.length < 2) continue;
    const m = miolo(texto);
    if (m.length >= 5) saida.push(m);
  }

  return [...new Set(saida)];
}

export type Confianca = "certa" | "provavel" | "fraca";

export interface Palpite {
  idCliente: string;
  pontos: number;
  confianca: Confianca;
  /** Em português, pra caber no pedido de fusão sem tradução. */
  motivos: string[];
}

/** Sobreposição de faixa de preço, com folga de 15% pros dois lados. */
function faixaCompativel(
  a: { min?: number | null; max?: number | null },
  b: { min?: number | null; max?: number | null },
): boolean {
  const aMin = (a.min ?? 0) * 0.85;
  const aMax = (a.max ?? Infinity) * 1.15;
  const bMin = (b.min ?? 0) * 0.85;
  const bMax = (b.max ?? Infinity) * 1.15;
  return aMin <= bMax && bMin <= aMax;
}

/**
 * Compara o contato que chegou com um candidato já no banco.
 *
 * `certa` casa sozinho. `provavel` vira pedido de fusão. `fraca` é ignorado —
 * devolvido só pra quem quiser auditar por que não casou.
 */
export function compararIdentidade(
  novo: SinaisContato,
  candidato: SinaisContato & { idCliente: string; identidades: Identidade[] },
  agora = new Date(),
): Palpite {
  const motivos: string[] = [];
  let pontos = 0;

  // --- Determinístico: acaba a conversa aqui. ---

  if (novo.cpf && candidato.cpf && soDigitos(novo.cpf) === soDigitos(candidato.cpf)) {
    return {
      idCliente: candidato.idCliente,
      pontos: PESOS.cpf,
      confianca: "certa",
      motivos: ["mesmo CPF"],
    };
  }

  const jaVisto = candidato.identidades.find(
    (i) => i.canal === novo.canal && i.identificador === normalizar(novo.identificador),
  );
  if (jaVisto) {
    return {
      idCliente: candidato.idCliente,
      pontos: PESOS.cpf,
      confianca: "certa",
      motivos: [`já conhecido no ${novo.canal}`],
    };
  }

  // --- Probabilístico: soma de indícios, nenhum decisivo. ---

  if (novo.email && candidato.email && normalizar(novo.email) === normalizar(candidato.email)) {
    pontos += PESOS.email;
    motivos.push("mesmo e-mail");
  }

  const meus = nucleos(novo);
  const dele = candidato.identidades.flatMap((i) =>
    nucleos({ identificador: i.identificador, apelido: i.apelido }).map((n) => ({
      nucleo: n,
      canal: i.canal,
      identificador: i.identificador,
    })),
  );

  // Igualdade exata entre os miolos: `ju.mendes.sp` do Instagram e "Ju Mendes"
  // do perfil do WhatsApp viram os dois `jumendes`. Não importa de qual campo
  // cada um veio — o que importa é a mesma pessoa ter escolhido o mesmo nome
  // duas vezes.
  const exato = dele.find((d) => d.canal !== novo.canal && meus.includes(d.nucleo));
  if (exato) {
    pontos += PESOS.handle;
    motivos.push(`mesmo apelido usado no ${exato.canal} (${exato.identificador})`);
  } else if (
    // Contido, e não igual: o @ escrito dentro de um nome mais longo, ou um
    // e-mail que começa com o handle. Vale menos porque coincide com mais
    // facilidade.
    dele.some((d) => meus.some((m) => d.nucleo.includes(m) || m.includes(d.nucleo)))
  ) {
    pontos += PESOS.handleNoApelido;
    motivos.push("apelido de um canal aparece dentro do outro");
  }

  const nomeNovo = normalizar(novo.apelido ?? novo.nome);
  const nomeCand = normalizar(candidato.nome);
  // Nome só entra se tiver sobrenome. "ju" batendo com "ju" não é indício.
  if (nomeNovo && nomeNovo === nomeCand && nomeNovo.includes(" ")) {
    pontos += PESOS.nome;
    motivos.push("mesmo nome");
  }

  if (
    novo.idImovelCitado &&
    candidato.idImovelCitado === novo.idImovelCitado &&
    candidato.ultimaAtividade &&
    (agora.getTime() - candidato.ultimaAtividade.getTime()) / 86_400_000 <= JANELA_DIAS
  ) {
    pontos += PESOS.mesmoImovel;
    motivos.push("perguntou pelo mesmo imóvel nos últimos dias");
  }

  if (novo.busca && candidato.busca) {
    const bairrosEmComum = (novo.busca.bairros ?? []).some((b) =>
      (candidato.busca!.bairros ?? []).map(normalizar).includes(normalizar(b)),
    );
    const mesmoTipo =
      !novo.busca.tipo ||
      !candidato.busca.tipo ||
      normalizar(novo.busca.tipo) === normalizar(candidato.busca.tipo);

    if (bairrosEmComum && mesmoTipo && faixaCompativel(novo.busca, candidato.busca)) {
      pontos += PESOS.buscaCompativel;
      motivos.push("procura o mesmo tipo de imóvel na mesma região e faixa");
    }
  }

  return {
    idCliente: candidato.idCliente,
    pontos,
    confianca: pontos >= LIMITE_SUGESTAO ? "provavel" : "fraca",
    motivos,
  };
}

export type Veredito =
  | { acao: "vincular"; idCliente: string; motivo: string }
  | { acao: "sugerir_fusao"; palpite: Palpite; concorrentes: number }
  | { acao: "criar_cliente" };

/**
 * O que fazer com um contato que chegou.
 *
 * Três saídas e nenhuma delas é "funde e torce":
 * - **vincular** — tem certeza, escreve a identidade no cliente existente.
 * - **sugerir_fusao** — tem palpite, abre pedido pra alguém confirmar.
 * - **criar_cliente** — não tem nada, cria novo. Duplicar é reversível.
 *
 * O empate é tratado de propósito: dois candidatos igualmente prováveis
 * significam que os sinais não distinguem ninguém, e escolher o primeiro da
 * lista seria sorteio. Nesse caso o palpite vai pro humano com os dois.
 */
export function resolverIdentidade(
  novo: SinaisContato,
  candidatos: (SinaisContato & { idCliente: string; identidades: Identidade[] })[],
  agora = new Date(),
): Veredito {
  const palpites = candidatos
    .map((c) => compararIdentidade(novo, c, agora))
    .sort((a, b) => b.pontos - a.pontos);

  const melhor = palpites[0];
  if (!melhor || melhor.confianca === "fraca") return { acao: "criar_cliente" };

  if (melhor.confianca === "certa") {
    return {
      acao: "vincular",
      idCliente: melhor.idCliente,
      motivo: melhor.motivos[0] ?? "chave determinística",
    };
  }

  const empatados = palpites.filter((p) => p.confianca === "provavel").length;
  return { acao: "sugerir_fusao", palpite: melhor, concorrentes: empatados };
}

/**
 * A pergunta que o Agente 4 faz quando o palpite não fecha sozinho.
 *
 * É o caminho mais barato e mais preciso de todos: em vez de adivinhar por
 * sinal, pergunta pra quem sabe. Só que precisa ser feita de um jeito que não
 * entregue dado de outra pessoa — daí o primeiro nome apenas, e nada de
 * imóvel, valor ou corretor.
 */
export function perguntaDeConfirmacao(
  candidato: { nome: string },
  canalAnterior: CanalIdentidade,
): string {
  const primeiroNome = candidato.nome.trim().split(/\s+/)[0] ?? "";
  return `Só pra eu não abrir um cadastro repetido: você já falou com a gente pelo ${canalAnterior}, como ${primeiroNome}? (responda sim ou não)`;
}
