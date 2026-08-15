const http = require('node:http');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: 8080,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let buf = '';
      res.on('data', c => { buf += c; });
      res.on('end', () => {
        resolve({ status: res.statusCode, data: JSON.parse(buf) });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  console.log('Testing MCQ Refinement & Expansion...');
  const mcqRes = await post('/api/refine-question', {
    question_data: {
      id: 'CRIM-MCQ-001',
      type: 'mcq',
      domain: 'Criminal Law',
      topic: 'Mistake of Fact (Ah Chong Doctrine)',
      question: 'Which of the following is NOT an element of mistake of fact as a defense?',
      options: [
        'A) That the act done would have been lawful had the facts been as the accused believed them to be.',
        'B) That the intention of the accused in performing the act should be lawful.',
        'C) That the mistake was due to culpable negligence of the accused.',
        'D) That the belief of the accused was based on reasonable grounds.'
      ],
      correct_answer: 'C',
      explanation: 'The mistake must not be due to culpable negligence or fault on the part of the accused.'
    },
    refinement_instruction: 'Add a complex factual premise testing negligence.'
  });
  console.log('✅ MCQ Refine Success:', mcqRes.data.success);
  console.log('Refined MCQ Stem:', mcqRes.data.refined.question);

  console.log('\nTesting Dean Phoenix RAG Chatbot...');
  const chatRes = await post('/api/chat', {
    messages: [
      { role: 'user', content: 'Explain the Ah Chong doctrine on mistake of fact under Criminal Law' }
    ]
  });
  console.log('✅ Chatbot RAG Success:', chatRes.data.success);
  console.log('Citations Count:', chatRes.data.citations.length);
  console.log('Citations:', chatRes.data.citations);
  console.log('Reply Excerpt:', chatRes.data.reply.slice(0, 180) + '...');
}

run().catch(console.error);
