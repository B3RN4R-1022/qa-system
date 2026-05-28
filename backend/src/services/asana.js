const Asana = require('asana')

const client = Asana.ApiClient.instance
const token = client.authentications['token']
token.accessToken = process.env.ASANA_TOKEN

const tasksApi = new Asana.TasksApi()
const storiesApi = new Asana.StoriesApi()

async function getTask(taskId) {
  const response = await tasksApi.getTask(taskId, {
    opt_fields: 'name,notes,assignee.name,start_on,custom_fields,custom_fields.name,custom_fields.display_value,custom_fields.type,custom_fields.enum_value,estimated_time,actual_time_minutes'
  })
  return response.data
}

async function addComment(taskId, text) {
  const token = process.env.ASANA_TOKEN
  await fetch(`https://app.asana.com/api/1.0/tasks/${taskId}/stories`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ data: { text } })
  })
}

async function updateTaskStatus(taskId, customFieldId, enumOptionId) {
  await tasksApi.updateTask(taskId, {
    data: {
      custom_fields: {
        [customFieldId]: enumOptionId
      }
    }
  }, {})
}

async function getPreviewUrl(taskId) {
  const response = await storiesApi.getStoriesForTask(taskId, {})
  const stories = response.data || []

  // Procura nos comentários por "Link para QA:"
  const comentario = stories.find(s =>
    s.type === 'comment' && s.text?.toLowerCase().includes('link para qa:')
  )

  if (!comentario) return null

  // Extrai a URL do comentário
  const match = comentario.text.match(/https?:\/\/[^\s]+/)
  return match ? match[0] : null
}

async function updateStatusByName(asanaId, statusName) {
  const token = process.env.ASANA_TOKEN

  // Busca a task para pegar o GID do campo Status
  const task = await getTask(asanaId)
  const statusField = task.custom_fields?.find(f => f.name === 'Status')
  if (!statusField) throw new Error('Campo Status não encontrado')

  // Busca as opções do campo
  const fieldRes = await fetch(`https://app.asana.com/api/1.0/custom_fields/${statusField.gid}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const fieldData = await fieldRes.json()

  // Acha a opção pelo nome
  const enumOption = fieldData.data?.enum_options?.find(opt => opt.name === statusName)
  if (!enumOption) throw new Error(`Status "${statusName}" não encontrado`)

  // Atualiza a task
  await fetch(`https://app.asana.com/api/1.0/tasks/${asanaId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      data: { custom_fields: { [statusField.gid]: enumOption.gid } }
    })
  })
}

module.exports = { getTask, addComment, updateTaskStatus, getPreviewUrl, updateStatusByName  }