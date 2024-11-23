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

const port = 3000;

function getAuthorizationHeader(req) {
    const symbols = Object.getOwnPropertySymbols(req);
    const kHeadersSymbol = symbols.find(sym => sym.toString() === 'Symbol(kHeaders)');
    const headers = req[kHeadersSymbol];
    return headers['authorization'];
}

const typeDefs = `
    type Query {
        foo: String!
        check: CheckResponse!
    }
    
    type CheckResponse {
        success: String!
    }
    
    type Response {
        token: String!
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
    
    type Mutation {
        post_login(input: LoginUser_input): Response
        post_register(input: RegisterUser_input): Response
        scheduleOperation(name: String!): String!
    }
    type Subscription {
        operationFinished: Operation!
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
                console.error('Error connecting to /login endpoint:', error);
                throw new Error(error.response?.data?.message || 'Failed to login');
            }
        },
        async post_register(_, { input }) {
            try {
                const response = await axios.post(vaporUrl + 'register', input);
                return { token: response.data.token };
            } catch (error) {
                console.error('Error connecting to /register endpoint:', error);
                throw new Error(error.response?.data?.message || 'Failed to register');
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
                console.log(authorization);
                //console.error('Error connecting to /check endpoint:', error);
                throw new Error(error.response?.data?.message || 'Failed to check');
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