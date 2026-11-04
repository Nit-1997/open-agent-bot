export const PRIVATE_TARGET = "That address isn't reachable from the server.";

export const PRIVATE_URLS = [
  "http://127.0.0.1:11434/v1",
  "http://localhost:8000/v1",
  "http://0.0.0.0:8000/v1",
  "http://10.0.0.5:8000/v1",
  "http://172.16.0.1/v1",
  "http://192.168.1.10/v1",
  "http://169.254.169.254/latest",
  "http://[::1]:8000/v1",
  "http://[::ffff:127.0.0.1]/v1",
  "http://2130706433/v1",
  "http://host.docker.internal:11434/v1",
  "http://ollama/v1",
];

export const GATEWAY = {
  baseUrl: "http://llm:4000/v1",
  apiKey: "sk-gateway-test",
  models: [{ id: "chat-default", label: "Qwen 3.5 (local)" }],
};
