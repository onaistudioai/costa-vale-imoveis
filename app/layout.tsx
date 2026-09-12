import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Costa & Vale — Painel",
  description: "Fila de decisões humanas e auditoria do estoque",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <header>
          <Link href="/" className="marca">
            Costa &amp; Vale
          </Link>
          <nav>
            <Link href="/">Fila</Link>
            <Link href="/funil">Atendimentos</Link>
            <Link href="/locacao">Locação</Link>
            <Link href="/escrituras">Escrituras</Link>
            <Link href="/alterar">Alterar</Link>
            <Link href="/consulta">Perguntar</Link>
            <Link href="/mensagens">Mensagens</Link>
            <Link href="/automatico">Automático</Link>
            <Link href="/cerebro">Cérebro</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
