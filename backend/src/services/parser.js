function extrairRequisitos(descricao) {
  if (!descricao) return []

  // Encontra a posição dos Critérios de Aceitação (funciona com ❇️ ou ✅)
  const indiceCriterios = descricao.toLowerCase().indexOf('critérios de aceitação')
  if (indiceCriterios === -1) return []

  // Pega o texto a partir dos critérios
  const textoCriterios = descricao.slice(indiceCriterios)

  const linhas = textoCriterios
    .split('\n')
    .slice(1)                                              // remove o título
    .map(l => l.trim())                                    // remove espaços
    .filter(l => l.length > 0)                            // remove linhas vazias
    .filter(l => !l.startsWith('❇️') && !l.startsWith('✅')) // para na próxima seção

  return linhas
}

module.exports = { extrairRequisitos }