const { searchKnowledge } = require("../knowledge/search");
const { buildSystemPrompt, classifyRequest } = require("./responsePolicy");

function prepareResponse(message) {
  const classification = classifyRequest(message);

  const results = searchKnowledge(message, 5);

  const knowledgeContext = results
    .map((item, index) =>
      `${index + 1}. Section: ${item.section}\nInformation: ${item.content}`
    )
    .join("\n\n");

  return {
    category: classification.category,
    requiresConfirmation: classification.requiresConfirmation,
    knowledgeResults: results,
    systemPrompt: buildSystemPrompt(knowledgeContext)
  };
}

module.exports = { prepareResponse };
