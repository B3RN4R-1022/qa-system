function extrairRequisitos(descricao) {
  if (!descricao) return []

  const indiceCriterios = descricao.toLowerCase().indexOf('critérios de aceitação')
  if (indiceCriterios === -1) return []

  const linhas = descricao.slice(indiceCriterios).split('\n').slice(1)

  const items = []
  for (const linha of linhas) {
    const l = linha.trim()
    if (!l) continue
    if (l.startsWith('❇️') || l.startsWith('✅')) break // para na próxima seção
    if (/^https?:\/\//.test(l)) continue                 // ignora linhas que são só URL
    if (/^•\s*https?:\/\//.test(l)) continue             // ignora bullet com URL
    items.push(l)
  }

  return items
}

// Entra na seção pelo label e retorna o primeiro URL encontrado até a próxima seção
function extrairLinkDaSecao(descricao, label) {
  if (!descricao) return null
  const linhas = descricao.split('\n')
  let dentro = false

  for (const linha of linhas) {
    const l = linha.trim()
    if (!l) continue

    if (!dentro) {
      if (l.toLowerCase().includes(label.toLowerCase())) {
        dentro = true
        // verifica se a URL já está na mesma linha do label
        const match = l.match(/https?:\/\/[^\s]+/)
        if (match) return match[0]
      }
      continue
    }

    // parar na próxima seção
    if (l.startsWith('❇️') || l.startsWith('✅')) break

    const match = l.match(/https?:\/\/[^\s]+/)
    if (match) return match[0]
  }

  return null
}

function extrairMockupUrl(descricao) {
  return extrairLinkDaSecao(descricao, 'Mockups/Designs')
}

function extrairTestUrl(descricao) {
  return extrairLinkDaSecao(descricao, 'Link de Teste')
}

module.exports = { extrairRequisitos, extrairMockupUrl, extrairTestUrl }