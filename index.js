import { ApolloServer } from '@apollo/server';
import { createServer } from 'http';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { makeExecutableSchema } from '@graphql-tools/schema';
import bodyParser from 'body-parser';
import express from 'express';
import axios from "axios";
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import { PubSub } from 'graphql-subscriptions';
import e from "express";

const port = 3000;

function getAuthorizationHeader(req) {
    const symbols = Object.getOwnPropertySymbols(req);
    const kHeadersSymbol = symbols.find(sym => sym.toString() === 'Symbol(kHeaders)');
    const headers = req[kHeadersSymbol];
    return headers['authorization'];
}

function errorHandler(error) {
    const errorReason = error.response?.data?.reason;
    throw new Error(`${errorReason}`);
}

const typeDefs = `
    type Ready {
        ready: Boolean!
    }
    
    type Result {
        result: String!
    }
    
    type CheckResponse {
        success: String!
    }
    
    type Response {
        token: String!
    }
    
    type ReadyResponse {
        message: String!
    }
    
    type ShakeResponse {
        message: String!
    }
    
    input GetResult_input {
        room_id: String!
        score: Int!
        user_id: String!
    }
     
    input LoginUser_input {
        email: String!
        password: String!
    }
    
    input RegisterUser_input {
        email: String!
        name: String!
        password: String!
    }
    
    input ShakePower_input {
        power: Int!
    }
    
    type Query {
        foo: String!
        check: CheckResponse!
        get_ready: Ready!
        get_result(input: GetResult_input): Result!
    }
    
    type Mutation {
        post_login(input: LoginUser_input): Response
        post_register(input: RegisterUser_input): Response
        post_ready: ReadyResponse
        post_shake(input: ShakePower_input): ShakeResponse
        scheduleOperation(name: String!): String!
    }
    type Subscription {
        operationFinished: Operation!
        post_matching: String!
    }

    type Operation {
        name: String!
        endDate: String!
    }
`;

const pubSub = new PubSub();

const mockLongLastingOperation = (name) => {
    setTimeout(() => {
        pubSub.publish('OPERATION_FINISHED', { operationFinished: { name, endDate: new Date().toDateString() } });
    }, 1000);
}

const vaporUrl = "http://localhost:8080/"

const resolvers = {
    Mutation: {
        scheduleOperation(_, { name }) {
            mockLongLastingOperation(name);
            return `Operation: ${name} scheduled!`;
        },
        async post_login(_, { input }) {
            try {
                const response = await axios.post(vaporUrl + 'login', input);
                return { token: response.data.token };
            } catch (error) {
                errorHandler(error);
            }
        },
        async post_register(_, { input }) {
            try {
                const response = await axios.post(vaporUrl + 'register', input);
                return { token: response.data.token };
            } catch (error) {
                errorHandler(error);
            }
        },
        async post_ready(_, __) {
            try {
                const response = await axios.post(vaporUrl + 'ready');
                return { message: response.data.message };
            } catch (error) {
                errorHandler(error);
            }
        },
        async post_shake(_, { input }) {
            try {
                const response = await axios.post(vaporUrl + 'shake', input);
                return { message: response.data.message };
            } catch (error) {
                errorHandler(error);
            }
        }
    },
    Query: {
        async check(_, __, { req }) {
            const authorization = getAuthorizationHeader(req);
            try {
                const response = await axios.get(vaporUrl + 'check', {
                    headers: {
                        'Authorization':" Bearer " + authorization
                    }
                });
                return { success: 'True', user: response.data.user };
            } catch (error) {
                errorHandler(error);
            }
        },
        async get_ready(_, __, { req }) {
            const authorization = getAuthorizationHeader(req);
            try {
                const response = await axios.get(vaporUrl + 'ready', {
                    headers: {
                        'Authorization': " Bearer " + authorization
                    }
                });
                return {ready: response.data.ready};
            } catch (error) {
                errorHandler(error);
            }
        },
        async get_result(_, { input }, { req }) {
            const authorization = getAuthorizationHeader(req);
            try {
                const response = await axios.get(vaporUrl + 'result', {
                    headers: {
                        'Authorization': " Bearer " + authorization
                    }
                });
                return {result: response.data.result};
            } catch (error) {
                errorHandler(error);
            }
        }
    },
    Subscription: {
        operationFinished: {
            subscribe: () => pubSub.asyncIterator(['OPERATION_FINISHED'])
        }
    }
};

const schema = makeExecutableSchema({ typeDefs, resolvers });

const app = express();
const httpServer = createServer(app);

const wsServer = new WebSocketServer({
    server: httpServer,
    path: '/graphql'
});

const wsServerCleanup = useServer({schema}, wsServer);

const apolloServer = new ApolloServer({
    schema,
    context: ({ req }) => {
        return { req };
    },
    plugins: [
        // Proper shutdown for the HTTP server.
        ApolloServerPluginDrainHttpServer({ httpServer }),

        // Proper shutdown for the WebSocket server.
        {
            async serverWillStart() {
                return {
                    async drainServer() {
                        await wsServerCleanup.dispose();
                    }
                }
            }
        }
    ]
});

await apolloServer.start();

app.use('/graphql', bodyParser.json(), expressMiddleware(apolloServer, {
    context: ({ req }) => ({ req })
}));

httpServer.listen(port, () => {
    console.log(`🚀 Query endpoint ready at http://localhost:${port}/graphql`);
    console.log(`🚀 Subscription endpoint ready at ws://localhost:${port}/graphql`);
});