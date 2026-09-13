import pytest
from pydantic import ValidationError

from mesa.crew import montar
from mesa.modelos import Caso, Consolidado, Olhar
from mesa.modelos import Recomendacao as R
from mesa.regra import aplicar_divergencia


def olhar(r: R) -> Olhar:
    return Olhar(leitura="l", preocupacao="p", recomendacao=r)


def consolidado(r: R = R.aprovar) -> Consolidado:
    return Consolidado(recomendacao=r, justificativa="j", convergiu=True, ressalva=None)


def test_concordando_passa_e_marca_convergiu():
    c = aplicar_divergencia(consolidado(), [olhar(R.aprovar), olhar(R.aprovar)])
    assert c.recomendacao is R.aprovar and c.convergiu


def test_divergencia_vira_humano_mesmo_se_o_supervisor_escolheu_lado():
    c = aplicar_divergencia(consolidado(R.aprovar), [olhar(R.aprovar), olhar(R.negar)])
    assert c.recomendacao is R.precisa_humano
    assert not c.convergiu
    assert "discordaram" in c.ressalva


def test_um_pedido_de_humano_basta():
    c = aplicar_divergencia(consolidado(), [olhar(R.precisa_humano), olhar(R.precisa_humano)])
    assert c.recomendacao is R.precisa_humano and "humano" in c.ressalva


def test_caso_torto_morre_na_porta():
    with pytest.raises(ValidationError):
        Caso(assunto="", fatos="x")
    with pytest.raises(ValidationError):
        Caso(assunto="a", fatos="x", idCliente="vazou")  # campo extra é recusado


def test_nenhum_agente_delega_e_os_olhares_nao_se_leem(monkeypatch):
    # R4: agente não conversa com agente. Delegação ligada seria isso.
    monkeypatch.setenv("GROQ_API_KEY", "teste")
    monkeypatch.setenv("MESA_MEMORIA", "0")
    crew, t_caut, t_oper = montar(Caso(assunto="a", fatos="f"))
    assert all(a.allow_delegation is False for a in crew.agents)
    # `== []` e não `not ...`: o padrão do CrewAI é um marcador verdadeiro
    # (NOT_SPECIFIED) que injeta a saída das tasks anteriores.
    assert t_caut.context == [] and t_oper.context == []
