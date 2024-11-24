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
        is_ready: Boolean!
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
    
    type UserID {
        user_id: String!
    }
    
    type RoomID {
        room_id: String!
    }
    
    type MatchStatus {
        user_count: Int
        is_matched: Boolean
        room_id: String 
        start_time: String
        setuna_time: String
    }
    
    type diffTime {
        difftime: String
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
        get_userID: UserID!
        get_rooms: [String]
    }   
    
    type Mutation {
        post_login(email: String!, password: String!): Response
        post_register(email: String!, name: String!, password: String!): Response
        scheduleOperation(name: String!): String!
        post_matching(is_leave: Boolean!): MatchStatus 
        post_result(room_id: String!, score: Int!): Result
        post_ready(room_id: String!): diffTime
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
        async post_login(_, { email, password }) {
            try {
                const input = { email, password };
                const response = await axios.post(vaporUrl + 'login', input);
                return { token: response.data.token };
            } catch (error) {
                errorHandler(error);
            }
        },
        async post_matching(_ , { is_leave }, { req }){
            const authorization = getAuthorizationHeader(req);
            try {
                const input = { is_leave };
                const response = await axios.post(vaporUrl + 'matching', input, {
                    headers: {
                        'Authorization': " Bearer " + authorization
                    }
                });
                return { user_count: response.data.user_count, is_matched: response.data.is_matched, room_id: response.data.room_id, start_time: response.data.start_time, setuna_time: response.data.setuna_time };
            } catch (error) {
                errorHandler(error);
            }
        },
        async post_ready(_, { room_id }, { req }) {
            const authorization = getAuthorizationHeader(req);
            try {
                const input = { room_id };
                const response = await axios.post(vaporUrl + 'ready', input, {
                    headers: {
                        'Authorization': " Bearer " + authorization
                    }
                });
                console.log(response.data.difftime);
                return { difftime: response.data.difftime };
            } catch (error) {
                errorHandler(error);
            }
        },
        async post_register(_, { email, name, password }) {
            try {
                const input = {email, name, password};
                const response = await axios.post(vaporUrl + 'register', input);
                return {token: response.data.token};
            } catch (error) {
                errorHandler(error);
            }
        },
        async post_result(_, { room_id, score }, { req }) {
            const authorization = getAuthorizationHeader(req);
            try {
                const input = { room_id, score };
                const response = await axios.post(vaporUrl + 'result', input, {
                    headers: {
                        'Authorization': " Bearer " + authorization
                    },
                });
                return {result: response.data.result};
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
        async get_rooms() {
            try {
                const response = await axios.get(vaporUrl + 'rooms');
                // Assuming `rooms` is an array of objects with a `room_id` field.
                return response.data;
            } catch (error) {
                errorHandler(error);
            }
        },
        async get_userID(_, __, { req }) {
            const authorization = getAuthorizationHeader(req);
            try {
                const response = await axios.get(vaporUrl + 'user', {
                    headers: {
                        'Authorization': " Bearer " + authorization
                    }
                });
                return {user_id: response.data.user_id};
            } catch (error) {
                errorHandler(error);
            }
        },
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