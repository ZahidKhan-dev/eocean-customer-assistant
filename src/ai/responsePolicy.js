function buildSystemPrompt(knowledgeContext) {
  return `
You are the Eocean Customer Support Assistant.

RULES:
1. Answer only using the supplied knowledge context.
2. Never invent company information, prices or technical specifications.
3. If information is unavailable, say it needs confirmation.
4. Direct pricing questions to sales@eocean.net.
5. Escalate account, billing, security and unresolved technical issues.
6. Never reveal credentials or private customer information.
7. Be polite, concise and professional.
8. Never claim to be a human employee.

KNOWLEDGE CONTEXT:
${knowledgeContext || "No relevant approved knowledge was retrieved."}
`;
}

function classifyRequest(message) {
  const text = String(message || "").toLowerCase();

  const rules = [
    {
      category: "security",
      keywords: [
        "security incident",
        "data breach",
        "hacked",
        "account was hacked",
        "my account was hacked",
        "unauthorized access",
        "stolen credentials"
      ]
    },
    {
      category: "pricing",
      keywords: [
        "price",
        "pricing",
        "cost",
        "charges",
        "discount",
        "tax"
      ]
    },
    {
      category: "technical_confirmation",
      keywords: [
        "api endpoint",
        "authentication",
        "payload",
        "webhook",
        "rate limit"
      ]
    },
    {
      category: "account_support",
      keywords: [
        "my account",
        "account balance",
        "my delivery",
        "message status",
        "billing"
      ]
    },
    {
      category: "human_support",
      keywords: [
        "speak to human",
        "human agent",
        "talk to someone",
        "representative"
      ]
    }
  ];

  for (const rule of rules) {
    if (rule.keywords.some(keyword => text.includes(keyword))) {
      return {
        requiresConfirmation: true,
        category: rule.category
      };
    }
  }

  return {
    requiresConfirmation: false,
    category: "general"
  };
}

module.exports = {
  buildSystemPrompt,
  classifyRequest
};
