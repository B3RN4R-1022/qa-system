const Asana = require('asana')

const client = Asana.ApiClient.instance
const token = client.authentications['token']
token.accessToken = process.env.ASANA_TOKEN

const tasksApi = new Asana.TasksApi()
const storiesApi = new Asana.StoriesApi()

async function getTask(taskId) {
  const response = await tasksApi.getTask(taskId, {})
  return response.data
}

async function addComment(taskId, text) {
  await storiesApi.createStoryForTask(taskId, {
    data: { text }
  }, {})
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

module.exports = { getTask, addComment, updateTaskStatus }