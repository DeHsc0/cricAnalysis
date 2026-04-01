import z from "zod";

const UserRole = z.enum(['admin', 'video_analyst', 'player']);
const MenCategory = z.enum(['under_14', 'under_16', 'under_19', 'under_23' , 'ranji']);
const WomenCategory = z.enum(['under_16', 'under_19', 'under_23', 'senior']);

const addPlayersSchema = z.object({

    matchId : z.string(),
    playerIds : z.array(z.string())

})

const createPlayerSchema = z.discriminatedUnion('gender', [
  z.object({
    username: z.string(),
    password: z.string(),
    role : UserRole,
    name : z.string(),
    gender: z.literal('men'),
    category: MenCategory,
  }),
  z.object({
    username: z.string(),
    password: z.string(),
    role : UserRole,
    name: z.string(),
    gender: z.literal('women'),
    category: WomenCategory,
  }),
]);

const loginSchema = z.object({

    username : z.string().max(15).min(4),
    password : z.string()

})

const createTournamentSchema = z.discriminatedUnion("gender" , [
    z.object({

        name : z.string(),
        analystId : z.string(),
        gender : z.literal("men"),
        category : MenCategory

    }),
    z.object({

        name : z.string(),
        analystId : z.string(),
        gender : z.literal("women"),
        category : WomenCategory

    })

])

const createMatchSchema = z.object({

    tournamentId : z.string(),
    name : z.string()

})

const signupSchema = z.object({

    username : z.string().max(15).min(4),
    password : z.string(),
    name : z.string().min(4),
    role : UserRole

})

export { loginSchema , signupSchema , createPlayerSchema , createTournamentSchema , createMatchSchema , addPlayersSchema } 