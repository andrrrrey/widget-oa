import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ASSISTANT_ID = process.env.ASSISTANT_ID;

app.post('/chat', async (req, res) => {
  try {
    // console.log(req.body);
    const { message } = req.body;
    let threadId = req.headers['x-thread-id'] || null;

    // Set up streaming response headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (!threadId) {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      res.write(`data: ${JSON.stringify({ info: { id: threadId } })}\n\n`);
      res.flush?.();
    }

    // Run assistant with streaming enabled
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: ASSISTANT_ID,
        additional_messages: [
          { role: "user", content: message }
        ],
      stream: true,
    });

    // Stream the response
    for await (const event of run) {
      // console.log(JSON.stringify(event, null, 2));
      if (event.event === 'thread.message.delta') {
        if (event.data?.delta?.content?.[0]?.type === 'text') {
          let chunk = event.data?.delta?.content[0].text.value;

          const annotationRegex = /【\d+:\d+†[^\s】]+】/g;
          chunk = chunk.replace(annotationRegex, "");

          if(chunk.trim() !== "") {
            res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
            res.flush?.();
          }
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/feedback', async (req, res) => {
  // console.log(req.body);
  res.status(200).json({ message: 'Feedback received' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});