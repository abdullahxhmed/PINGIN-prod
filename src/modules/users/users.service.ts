import {prisma} from "../../lib/prisma.js"


const createUser = async (name: string, mobileNumber: string) =>{
    console.time("create-user");
        const user = await prisma.user.create({
            data:{
                name,
                mobileNumber
            }
        });
        console.log(user);
        return user;

} 

const getUsers = async () => {
    const users = await prisma.user.findMany();
    return users;
}

export {
    createUser,
    getUsers
}