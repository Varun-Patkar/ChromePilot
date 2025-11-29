@echo off
echo Starting Ollama with CORS enabled for ChromePilot...
echo.
set OLLAMA_ORIGINS=chrome-extension://*
ollama serve
