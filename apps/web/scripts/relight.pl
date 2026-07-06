#!/usr/bin/perl
# Converte classes do tema ESCURO para o tema CLARO profissional (slate + blue).
# Ordem importa: variantes com /alpha e brackets ANTES das bases.
use strict; use warnings;
local $/; my $s = <>;

# --- Accent: indigo -> blue ---
$s =~ s/indigo-700/blue-700/g;
$s =~ s/indigo-600/blue-600/g;
$s =~ s/indigo-500/blue-600/g;
$s =~ s/indigo-400/blue-600/g;
$s =~ s/indigo-300/blue-500/g;
$s =~ s/indigo-200/blue-200/g;
$s =~ s/indigo-100/blue-100/g;
$s =~ s/indigo-50\b/blue-50/g;

# --- Scrims (overlays escuros) mantêm-se escuros translúcidos ---
$s =~ s/bg-zinc-950\/80/bg-slate-900\/40/g;
$s =~ s/bg-zinc-950\/70/bg-slate-900\/40/g;
$s =~ s/bg-zinc-950\/60/bg-slate-900\/30/g;
$s =~ s/bg-black\/\d+/bg-slate-900\/40/g;

# --- Backgrounds zinc (claro) ---
$s =~ s/bg-zinc-950\/50/bg-slate-50/g;
$s =~ s/bg-zinc-950\/40/bg-slate-50/g;
$s =~ s/bg-zinc-950/bg-slate-50/g;
$s =~ s/bg-zinc-900\/\d+/bg-white/g;
$s =~ s/bg-zinc-900/bg-white/g;
$s =~ s/bg-zinc-800\/\d+/bg-slate-100/g;
$s =~ s/bg-zinc-800/bg-slate-100/g;
$s =~ s/bg-zinc-700\/\d+/bg-slate-200/g;
$s =~ s/bg-zinc-700/bg-slate-200/g;

# --- White-alpha borders ---
$s =~ s/border-white\/\[0\.08\]/border-slate-200/g;
$s =~ s/border-white\/\[0\.0\d\]/border-slate-100/g;
$s =~ s/border-white\/20/border-slate-300/g;
$s =~ s/border-white\/10/border-slate-200/g;
$s =~ s/border-white\/5/border-slate-100/g;

# --- White-alpha backgrounds ---
$s =~ s/hover:bg-white\/10/hover:bg-slate-100/g;
$s =~ s/hover:bg-white\/5/hover:bg-slate-100/g;
$s =~ s/hover:bg-white\/\[0\.0\d\]/hover:bg-slate-50/g;
$s =~ s/bg-white\/10/bg-slate-100/g;
$s =~ s/bg-white\/5/bg-slate-50/g;
$s =~ s/bg-white\/\[0\.0\d\]/bg-slate-50/g;

# --- Rings ---
$s =~ s/ring-white\/10/ring-slate-200/g;
$s =~ s/ring-white\/5/ring-slate-200/g;

# --- Text zinc -> slate (invertido) ---
$s =~ s/text-zinc-100/text-slate-900/g;
$s =~ s/text-zinc-200/text-slate-800/g;
$s =~ s/text-zinc-300/text-slate-700/g;
$s =~ s/text-zinc-400/text-slate-600/g;
$s =~ s/text-zinc-500/text-slate-500/g;
$s =~ s/text-zinc-600/text-slate-400/g;
$s =~ s/text-zinc-700/text-slate-300/g;

# --- Placeholder ---
$s =~ s/placeholder:text-zinc-500/placeholder:text-slate-400/g;

# --- Hover text ---
$s =~ s/hover:text-zinc-100/hover:text-slate-900/g;
$s =~ s/hover:text-zinc-200/hover:text-slate-900/g;
$s =~ s/hover:text-zinc-300/hover:text-slate-700/g;

# --- Borders zinc ---
$s =~ s/border-zinc-800/border-slate-200/g;
$s =~ s/border-zinc-700/border-slate-300/g;

print $s;
