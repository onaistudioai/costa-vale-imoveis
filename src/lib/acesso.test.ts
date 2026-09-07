import { describe, expect, it, vi } from "vitest";
import { hashDaSenha, quemE, usuarios } from "./acesso";

const cabecalho = (nome: string, senha: string) =>
  `Basic ${Buffer.from(`${nome}:${senha}`, "utf8").toString("base64")}`;

const tabela = usuarios(`fabiano:${hashDaSenha("senha-boa")},ana:${hashDaSenha("outra")}`);

describe("usuarios", () => {
  it("ignora entrada malformada em vez de aceitar meio usuário", () => {
    const t = usuarios("semhash,:só-hash,ok:" + hashDaSenha("x") + ",curto:abc");
    expect([...t.keys()]).toEqual(["ok"]);
  });

  it("sem variável, a tabela vem vazia — e o painel fecha", () => {
    vi.stubEnv("PAINEL_USUARIOS", "");
    expect(usuarios().size).toBe(0);
    expect(usuarios("").size).toBe(0);
    vi.unstubAllEnvs();
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
    const t = usuarios(`ana:${hashDaSenha("a:b:c")}`);
    expect(quemE(cabecalho("ana", "a:b:c"), t)).toBe("ana");
    expect(quemE(cabecalho("ana", "a"), t)).toBeNull();
  });

  it("a senha não aparece no que se guarda", () => {
    expect(hashDaSenha("senha-boa")).not.toContain("senha");
    expect(hashDaSenha("senha-boa")).toHaveLength(64);
  });
});
