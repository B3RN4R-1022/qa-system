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

// Aciona os botões nativos de aprovação do Asana
// approvalStatus: 'approved' | 'changes_requested' | 'rejected'
async function updateApprovalStatus(taskId, approvalStatus) {
  const token = process.env.ASANA_TOKEN
  const res = await fetch(`https://app.asana.com/api/1.0/tasks/${taskId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      data: { approval_status: approvalStatus }
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.errors?.[0]?.message || 'Erro ao atualizar aprovação')
}

async function getAttachments(taskId) {
  const token = process.env.ASANA_TOKEN
  const res = await fetch(
    `https://app.asana.com/api/1.0/attachments?parent=${taskId}&opt_fields=name,download_url,host,created_at`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  )
  const data = await res.json()
  return data.data || []
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

async function getMyWorkspaceGid() {
  const token = process.env.ASANA_TOKEN
  const res = await fetch('https://app.asana.com/api/1.0/users/me?opt_fields=workspaces', {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const data = await res.json()
  return data.data?.workspaces?.[0]?.gid
}

async function listAllProjects(workspaceGid) {
  const token = process.env.ASANA_TOKEN
  const res = await fetch(`https://app.asana.com/api/1.0/projects?workspace=${workspaceGid}&opt_fields=name,gid`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const data = await res.json()
  return data.data || []
}

async function registerWebhook(projectGid, webhookUrl) {
  const token = process.env.ASANA_TOKEN
  const res = await fetch('https://app.asana.com/api/1.0/webhooks', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: { resource: projectGid, target: webhookUrl }
    })
  })
  return res.json()
}

async function listWebhooks(workspaceGid) {
  const token = process.env.ASANA_TOKEN
  const res = await fetch(`https://app.asana.com/api/1.0/webhooks?workspace=${workspaceGid}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const data = await res.json()
  return data.data || []
}

module.exports = { getTask, addComment, updateTaskStatus, getPreviewUrl, updateStatusByName, updateApprovalStatus, getAttachments, getMyWorkspaceGid, listAllProjects, registerWebhook, listWebhooks }