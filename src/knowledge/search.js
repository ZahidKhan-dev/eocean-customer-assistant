const fs = require("fs");
const path = require("path");

const knowledgeFile = path.join(
  __dirname,
  "../../data/knowledge/company-profile.md"
);

const stopWords = new Set([
  "what", "which", "where", "when", "who", "does", "do",
  "is", "are", "the", "a", "an", "and", "or", "of",
  "to", "for", "how", "can", "could", "would", "please",
  "i", "we", "you", "your", "me", "my", "e ocean", "ecean",
  "eos", "eocean", "provide", "provides", "offering", "offer"
]);

const synonyms = {
  channel: ["channels", "messaging", "communication"],
  channels: ["channel", "messaging", "communication"],
  product: ["products", "solutions", "services"],
  products: ["product", "solutions", "services"],
  service: ["services", "products", "solutions"],
  services: ["service", "products", "solutions"],
  price: ["pricing", "cost", "charges", "taxes"],
  pricing: ["price", "cost", "charges", "taxes"],
  contact: ["email", "phone", "sales", "telephone"],
  whatsapp: ["whatsapp", "business"],
  api: ["api", "integration"]
};

function normalize(word) {
  return word.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(normalize)
    .filter(word => word.length > 1 && !stopWords.has(word))
    .map(word => {
      if (word.endsWith("ies") && word.length > 4) {
        return word.slice(0, -3) + "y";
      }
      if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) {
        return word.slice(0, -1);
      }
      return word;
    });
}

function loadKnowledgeBase() {
  if (!fs.existsSync(knowledgeFile)) {
    throw new Error(`Knowledge file not found: ${knowledgeFile}`);
  }

  const content = fs.readFileSync(knowledgeFile, "utf8");
  const lines = content.split(/\r?\n/);

  const documents = [];
  let currentSection = "General";
  let paragraph = [];

  function saveParagraph() {
    const text = paragraph.join(" ").trim();

    if (text) {
      documents.push({
        section: currentSection,
        content: text
      });
    }

    paragraph = [];
  }

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)/);

    if (heading) {
      saveParagraph();
      currentSection = heading[1].trim();
    } else if (!line.trim()) {
      saveParagraph();
    } else {
      paragraph.push(line.trim());
    }
  }

  saveParagraph();
  return documents;
}

function searchKnowledge(query, limit = 5) {
  const normalizedQuery = query.toLowerCase();

  if (
    normalizedQuery.includes("product") &&
    (
      normalizedQuery.includes("list") ||
      normalizedQuery.includes("what") ||
      normalizedQuery.includes("provide") ||
      normalizedQuery.includes("portfolio")
    )
  ) {
    const allDocuments = loadKnowledgeBase();

    const productNames = [
      "Digital Connect",
      "Voxara",
      "Xnotify",
      "Answers",
      "Conversations",
      "Moments"
    ];

    const products = allDocuments.filter(document =>
      productNames.includes(document.section)
    );

    return products.map(document => ({
      section: document.section,
      content: document.content,
      score: 10,
      matched: ["product portfolio"]
    }));
  }
  if (typeof query !== "string" || !query.trim()) {
    return [];
  }

  const queryWords = [...new Set(tokenize(query))];

  for (const word of [...queryWords]) {
    if (synonyms[word]) {
      queryWords.push(...synonyms[word].map(normalize));
    }
  }

  const uniqueWords = [...new Set(queryWords)];
  const documents = loadKnowledgeBase();

  const results = documents.map(document => {
    const headingWords = tokenize(document.section);
    const contentWords = tokenize(document.content);

    let score = 0;
    const matched = [];

    for (const word of uniqueWords) {
      const headingMatch = headingWords.includes(word);
      const contentMatch = contentWords.includes(word);

      if (headingMatch) {
        score += 3;
        matched.push(word);
      } else if (contentMatch) {
        score += 1;
        matched.push(word);
      }
    }

    return {
      section: document.section,
      content: document.content,
      score,
      matched: [...new Set(matched)]
    };
  });

  return results
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score);
}

module.exports = { loadKnowledgeBase, searchKnowledge };
