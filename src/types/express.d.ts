export {};

declare global {
    namespace Express {
        interface Request{
            user?:{
                broker_id: string;
                firm_id: string;
                isOwner?: boolean;
            };
        }
    }
}
