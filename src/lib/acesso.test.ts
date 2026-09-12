import { describe, expect, it, vi } from "vitest";
import { gerarSal, hashDaSenha, quemE, usuarios } from "./acesso";

const cabecalho = (nome: string, senha: string) =>
  `Basic ${Buffer.from(`${nome}:${senha}`, "utf8").toString("base64")}`;

/** Monta a linha do `.env` do jeito que o `npm run acesso` monta. */
const linha = (nome: string, senha: string, sal = gerarSal()) =>
  `${nome}:${sal}:${hashDaSenha(senha, sal)}`;

const tabela = usuarios(`${linha("fabiano", "senha-boa")},${linha("ana", "outra")}`);

describe("usuarios", () => {
  it("ignora entrada malformada em vez de aceitar meio usuário", () => {
    const t = usuarios(
      `semhash,:só-hash,${linha("ok", "x")},curto:abc,${"semsal"}:${"f".repeat(64)}`,
    );
    expect([...t.keys()]).toEqual(["ok"]);
  });

  // O formato antigo era `nome:hash` com SHA-256 puro. Não há como derivar o
  // sal de um hash que não tem sal: o certo é fechar e mandar regerar.
  it("formato antigo sem sal não entra — regerar é o único caminho", () => {
    expect(usuarios(`fabiano:${"a".repeat(64)}`).size).toBe(0);
  });

  it("sem variável, a tabela vem vazia — e o painel fecha", () => {
    vi.stubEnv("PAINEL_USUARIOS", "");
    expect(usuarios().size).toBe(0);
    expect(usuarios("").size).toBe(0);
    vi.unstubAllEnvs();
  });
});

describe("hashDaSenha", () => {
  it("a senha não aparece no que se guarda", () => {
    const sal = gerarSal();
    expect(hashDaSenha("senha-boa", sal)).not.toContain("senha");
    expect(hashDaSenha("senha-boa", sal)).toHaveLength(64);
  });

  // O ponto do sal: a mesma senha em duas pessoas não pode dar o mesmo hash,
  // senão o `.env` denuncia quem repetiu senha.
  it("sais diferentes dão hashes diferentes para a mesma senha", () => {
    expect(hashDaSenha("igual", gerarSal())).not.toBe(hashDaSenha("igual", gerarSal()));
  });

  it("o mesmo sal e a mesma senha dão o mesmo hash", () => {
    const sal = gerarSal();
    expect(hashDaSenha("igual", sal)).toBe(hashDaSenha("igual", sal));
  });
});

describe("quemE", () => {
  it("devolve o nome de quem entrou, que é o que vira o 'decidido por'", () => {
    expect(quemE(cabecalho("fabiano", "senha-boa"), tabela)).toBe("fabiano");
  });

  it("senha errada não entra, mesmo com usuário certo", () => {
    expect(quemE(cabecalho("fabiano", "senha-boa "), tabela)).toBeNull();
    expect(quemE(cabecalho("fabiano", "outra"), tabela)).toBeNull();
  });

  it("usuário inexistente não entra", () => {
    expect(quemE(cabecalho("ninguem", "senha-boa"), tabela)).toBeNull();
  });

  it("cabeçalho ausente ou de outro esquema não entra", () => {
    expect(quemE(null, tabela)).toBeNull();
    expect(quemE("Bearer abc", tabela)).toBeNull();
    expect(quemE("Basic %%%", tabela)).toBeNull();
  });

  // Senha com dois-pontos é comum em gerador; cortar no primeiro separador
  // seria transformar "a:b" em senha "a" e deixar entrar com metade.
  it("senha com dois-pontos continua sendo a senha inteira", () => {
    const t = usuarios(linha("ana", "a:b:c"));
    expect(quemE(cabecalho("ana", "a:b:c"), t)).toBe("ana");
    expect(quemE(cabecalho("ana", "a"), t)).toBeNull();
  });
});
