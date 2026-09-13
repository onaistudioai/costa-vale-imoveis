"""A regra de divergência — código, não prompt.

Separada da crew de propósito: é função pura, testável sem rede e sem chave. O
supervisor é instruído a segui-la, mas instrução em prompt é pedido, e o caso em
que ela mais importa é o ambíguo, onde o modelo é menos confiável.
"""

from .modelos import Consolidado, Olhar, Recomendacao


def aplicar_divergencia(consolidado: Consolidado, olhares: list[Olhar]) -> Consolidado:
    divergiu = len({o.recomendacao for o in olhares}) > 1
    pediu_humano = any(o.recomendacao is Recomendacao.precisa_humano for o in olhares)

    if not (divergiu or pediu_humano):
        return consolidado.model_copy(update={"convergiu": True})

    ressalva = consolidado.ressalva or (
        "Os dois pareceres discordaram entre si."
        if divergiu
        else "Um dos pareceres pediu olhar humano."
    )
    return consolidado.model_copy(
        update={
            "recomendacao": Recomendacao.precisa_humano,
            "convergiu": False,
            "ressalva": ressalva,
        }
    )
