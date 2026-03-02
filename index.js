const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const axios = require("axios");
require("dotenv").config();

const N8N_BASE_URL = process.env.N8N_BASE_URL;
const N8N_API_KEY = process.env.N8N_API_KEY;

if (!N8N_BASE_URL || !N8N_API_KEY) {
    console.error("Missing N8N_BASE_URL or N8N_API_KEY in .env file");
    process.exit(1);
}

const n8n = axios.create({
    baseURL: `${N8N_BASE_URL}/api/v1`,
    headers: {
        "X-N8N-API-KEY": N8N_API_KEY,
    },
});

const server = new Server(
    {
        name: "n8n-mcp-server",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

/**
 * List available tools.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "list_workflows",
                description: "List all workflows from the n8n instance",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
            {
                name: "get_workflow",
                description: "Get details of a specific n8n workflow by ID",
                inputSchema: {
                    type: "object",
                    properties: {
                        id: { type: "string", description: "The workflow ID" },
                    },
                    required: ["id"],
                },
            },
            {
                name: "update_workflow",
                description: "Update an existing n8n workflow",
                inputSchema: {
                    type: "object",
                    properties: {
                        id: { type: "string", description: "The workflow ID to update" },
                        name: { type: "string", description: "The name of the workflow" },
                        nodes: { type: "array", description: "Array of n8n nodes" },
                        connections: { type: "object", description: "Connections between nodes" },
                        settings: { type: "object", description: "Workflow settings" },
                        staticData: { type: "object", description: "Static data for the workflow" },
                    },
                    required: ["id"],
                },
            },
            {
                name: "delete_workflow",
                description: "Delete an n8n workflow by ID",
                inputSchema: {
                    type: "object",
                    properties: {
                        id: { type: "string", description: "The workflow ID to delete" },
                    },
                    required: ["id"],
                },
            },
            {
                name: "migrate_agent_node",
                description: "Migrate deprecated 'AI Agent' node to 'Tools Agent' in a workflow",
                inputSchema: {
                    type: "object",
                    properties: {
                        id: { type: "string", description: "The workflow ID" },
                    },
                    required: ["id"],
                },
            },
            {
                name: "execute_workflow",
                description: "Trigger/Execute an n8n workflow by ID",
                inputSchema: {
                    type: "object",
                    properties: {
                        id: { type: "string", description: "The workflow ID" },
                        data: { type: "object", description: "Optional data to send to the workflow" },
                    },
                    required: ["id"],
                },
            },
            {
                name: "create_workflow",
                description: "Create a new n8n workflow",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "The name of the workflow" },
                        nodes: { type: "array", description: "Array of n8n nodes" },
                        connections: { type: "object", description: "Connections between nodes" },
                        settings: { type: "object", description: "Workflow settings" },
                        staticData: { type: "object", description: "Static data for the workflow" },
                    },
                    required: ["name", "nodes", "connections"],
                },
            },
        ],
    };
});

/**
 * Handle tool execution.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        switch (name) {
            case "list_workflows": {
                const response = await n8n.get("/workflows");
                return {
                    content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
                };
            }
            case "get_workflow": {
                const response = await n8n.get(`/workflows/${args.id}`);
                return {
                    content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
                };
            }
            case "execute_workflow": {
                const response = await n8n.post(`/workflows/${args.id}/run`, args.data || {});
                return {
                    content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
                };
            }
            case "create_workflow": {
                const response = await n8n.post("/workflows", {
                    name: args.name,
                    nodes: args.nodes,
                    connections: args.connections,
                    settings: args.settings || {},
                    staticData: args.staticData || {},
                });
                return {
                    content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
                };
            }
            case "update_workflow": {
                const response = await n8n.put(`/workflows/${args.id}`, {
                    name: args.name,
                    nodes: args.nodes,
                    connections: args.connections,
                    settings: args.settings,
                    staticData: args.staticData,
                });
                return {
                    content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
                };
            }
            case "delete_workflow": {
                const response = await n8n.delete(`/workflows/${args.id}`);
                return {
                    content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
                };
            }
            case "migrate_agent_node": {
                // 1. Get current workflow
                const getResponse = await n8n.get(`/workflows/${args.id}`);
                const workflow = getResponse.data;
                let modified = false;

                // 2. Find and replace the deprecated Agent node
                // The deprecated type is often '@n8n/n8n-nodes-langchain.agent' with low version
                // The new Tools Agent is '@n8n/n8n-nodes-langchain.agent' with version >= 1.6
                // or sometimes named 'Tools Agent'
                workflow.nodes = workflow.nodes.map(node => {
                    if (node.type === '@n8n/n8n-nodes-langchain.agent' && node.typeVersion < 1.6) {
                        modified = true;
                        return {
                            ...node,
                            typeVersion: 1.6, // Upgrade to Tools Agent version
                            parameters: {
                                ...node.parameters,
                                agent: 'toolsAgent', // Set to Tools Agent
                            }
                        };
                    }
                    return node;
                });

                if (!modified) {
                    return {
                        content: [{ type: "text", text: "No deprecated AI Agent nodes found or already migrated." }],
                    };
                }

                // 3. Update the workflow
                const updateResponse = await n8n.put(`/workflows/${args.id}`, {
                    nodes: workflow.nodes,
                    connections: workflow.connections,
                });

                return {
                    content: [{ type: "text", text: `Successfully migrated workflow ${args.id}. Result: ${JSON.stringify(updateResponse.data, null, 2)}` }],
                };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error: ${error.response?.data?.message || error.message}`,
                },
            ],
            isError: true,
        };
    }
});

/**
 * Main function to run the server.
 */
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("n8n MCP server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
