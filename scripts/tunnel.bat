@echo off
echo.
echo  Starting ngrok tunnel for Follow MCP server...
echo.
echo  After the tunnel starts, copy the https URL and use it as:
echo.
echo  Claude.ai:  Settings ^> Connectors ^> Add Custom Connector
echo              URL: https://YOUR-SUBDOMAIN.ngrok-free.app/mcp
echo.
echo  ChatGPT:    Custom GPT ^> Actions ^> Import from URL
echo              URL: https://YOUR-SUBDOMAIN.ngrok-free.app/api/mcp-rest/openapi.json
echo.
echo  Health check:
echo              curl https://YOUR-SUBDOMAIN.ngrok-free.app/api/health
echo.
echo ──────────────────────────────────────────────────────────────
echo.
ngrok http 3001
