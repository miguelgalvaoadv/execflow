#!/usr/bin/perl
# 2ª passada (linha a linha): casos especiais do dark->light.
use strict; use warnings;
while (my $l = <>) {
  # shades escuros de indigo
  $l =~ s/indigo-950/blue-900/g;
  $l =~ s/indigo-900/blue-900/g;
  $l =~ s/indigo-800/blue-800/g;

  # zinc remanescentes
  $l =~ s/text-zinc-950/text-slate-900/g;
  $l =~ s/text-zinc-900/text-slate-900/g;
  $l =~ s/text-zinc-800/text-slate-800/g;
  $l =~ s/hover:bg-zinc-200/hover:bg-slate-200/g;
  $l =~ s/bg-zinc-100/bg-slate-100/g;
  $l =~ s/bg-zinc-200/bg-slate-200/g;
  $l =~ s/bg-zinc-500/bg-slate-400/g;
  $l =~ s/bg-zinc-400/bg-slate-400/g;
  $l =~ s/border-zinc-900/border-slate-200/g;
  $l =~ s/border-zinc-600/border-slate-300/g;

  # hover para branco nunca serve no claro
  $l =~ s/hover:text-white/hover:text-slate-900/g;

  # caixas/inputs escuros translúcidos que NÃO são overlays -> claro
  if ($l !~ /inset-0/) {
    $l =~ s/bg-slate-900\/40/bg-slate-50/g;
    $l =~ s/bg-slate-900\/30/bg-slate-50/g;
  }

  # text-white "solto" (valor de texto) -> escuro, exceto sobre preenchimento colorido
  if ($l !~ /bg-(blue|emerald|amber|red|purple|green|indigo|rose|pink|teal|cyan|sky|violet|orange)-\d/
      && $l !~ /from-\w+-\d/ && $l !~ /to-\w+-\d/) {
    $l =~ s/\btext-white\b/text-slate-900/g;
  }

  print $l;
}
