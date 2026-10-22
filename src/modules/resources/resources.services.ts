import { ResourceType, QrTagStatus } from "@prisma/client";
import { randomBytes } from "crypto";
import { InternalError, NotFoundError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { buildContactUrl } from "../public-contact/contact.services.js";
import { decryptPhoneNumber } from "../../utils/phone-encryption.js";

type vehicleDetailsInput = {
    registrationNum?:string;
    vehicleColour?:string;
}



const getCallerLastTwoDigits = (encryptedOrRawPhone?: string | null): string => {
    if (!encryptedOrRawPhone) return "";
    let raw = "";
    try {
        if (encryptedOrRawPhone.includes(":")) {
            raw = decryptPhoneNumber(encryptedOrRawPhone);
        } else {
            raw = encryptedOrRawPhone;
        }
    } catch {
        return "";
    }

    const digitsOnly = raw.replace(/\D/g, "");
    if (digitsOnly.length < 2) return "";
    return digitsOnly.slice(-2);
};

const formatDuration = (sec: number): string => {
    if (!sec || sec <= 0) return "0s";
    const mins = Math.floor(sec / 60);
    const remainingSec = sec % 60;
    if (mins === 0) return `${remainingSec}s`;
    return `${mins}m ${remainingSec}s`;
};

const createResource = async (userId:string,name: string, type: ResourceType, vehicleDetails?:vehicleDetailsInput) => {

    const token = randomBytes(32).toString("hex");
    try{
        const {resource, contactLink, vehicle} = await prisma.$transaction(async (tx) => {
            const resource = await tx.resource.create({
                data: {
                    userId,
                    name,
                    type
                }
            });

            const contactLink = await tx.contactLink.create({
                data: {
                    resourceId: resource.id,
                    token: token
                }
            });
            let vehicle = null;
            if(type === "VEHICLE" && vehicleDetails){
                vehicle = await tx.vehicleDetail.create({
                    data: {
                        resourceId: resource.id,
                        registrationNum: vehicleDetails.registrationNum ?? null,
                        vehicleColour: vehicleDetails.vehicleColour ?? null,
                    }
                });
            }
            return {resource, contactLink, vehicle};
        })
            
        const contactUrl = buildContactUrl(contactLink.token);
        return {resource, contactUrl, vehicle};

    }
    catch(err){
        console.log(err);
        throw new InternalError("Something went wrong, Please Try again.");
    }
  
}

const getResources = async (userId:string) => {
    const resources = await prisma.resource.findMany({
        where:{
            userId,
            active: true
        },
        include: {
            vehicleDetail: true,
            contactLink: true,
            qrTag: {
                where: {
                    status: "ASSIGNED",
                },
            },
            communicationSessions: {
                orderBy: { createdAt: "desc" },
                take: 5,
                include: {
                    calls: {
                        orderBy: { createdAt: "desc" },
                        take: 1,
                    },
                },
            },
        }
    });
    if(!resources)
        throw new NotFoundError("Resources not found!");

    return resources.map((resource) => {
        const activeTag = resource.qrTag?.[0] ?? null;
        const recentCalls = (resource.communicationSessions || []).map((s) => {
            const latestCall = s.calls?.[0];
            const durationSec = latestCall?.durationSec ?? 0;
            const lastTwo = getCallerLastTwoDigits(s.contactorPhoneNumber);
            return {
                id: s.id,
                sessionId: s.id,
                caller: lastTwo ? `Visitor (••${lastTwo})` : "Anonymous Visitor",
                callerLastTwo: lastTwo || null,
                status: latestCall?.status ?? s.status,
                durationSec,
                duration: formatDuration(durationSec),
                createdAt: s.createdAt,
                type: s.type,
            };
        });

        return {
            id: resource.id,
            name: resource.name,
            type: resource.type,
            contactUrl: resource.contactLink ? buildContactUrl(resource.contactLink.token) : null,
            tagNumber: activeTag?.tagNumber ?? null,
            qrTag: activeTag ? {
                id: activeTag.id,
                tagNumber: activeTag.tagNumber,
                status: activeTag.status,
                origin: activeTag.origin,
                assignedAt: activeTag.assignedAt,
            } : null,
            vehicleDetails:{
                registrationNum: resource.vehicleDetail?.registrationNum ?? null,
                vehicleColour: resource.vehicleDetail?.vehicleColour ?? null,
            },
            recentCalls,
            calls: recentCalls,
            communications: recentCalls,
        };
    });
}


const checkIsAdmin = async (userId: string): Promise<boolean> => {
    const caller = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
    });
    return caller?.role === "ADMIN";
};

const getResourceById = async (resourceId: string, userId: string) => {
    const isAdmin = await checkIsAdmin(userId);
    const resource = await prisma.resource.findFirst({
        where:{
            id: resourceId,
            ...(isAdmin ? {} : { userId }),
            active: true,
        },
        include: {
            contactLink: true,
            vehicleDetail: true,
            qrTag: {
                where: {
                    status: "ASSIGNED",
                },
            },
            communicationSessions: {
                orderBy: { createdAt: "desc" },
                take: 10,
                include: {
                    calls: {
                        orderBy: { createdAt: "desc" },
                        take: 1,
                    },
                },
            },
        }
    })
    if(!resource)
        throw new NotFoundError("Resource not found")

    const activeTag = resource.qrTag?.[0] ?? null;
    const recentCalls = (resource.communicationSessions || []).map((s) => {
        const latestCall = s.calls?.[0];
        const durationSec = latestCall?.durationSec ?? 0;
        const lastTwo = getCallerLastTwoDigits(s.contactorPhoneNumber);
        return {
            id: s.id,
            sessionId: s.id,
            caller: lastTwo ? `Visitor (••${lastTwo})` : "Anonymous Visitor",
            callerLastTwo: lastTwo || null,
            status: latestCall?.status ?? s.status,
            durationSec,
            duration: formatDuration(durationSec),
            createdAt: s.createdAt,
            type: s.type,
        };
    });

    return {
        id: resource.id,
        name: resource.name,
        type: resource.type,
        contactUrl: resource.contactLink ? buildContactUrl(resource.contactLink.token) : null,
        tagNumber: activeTag?.tagNumber ?? null,
        qrTag: activeTag ? {
            id: activeTag.id,
            tagNumber: activeTag.tagNumber,
            status: activeTag.status,
            origin: activeTag.origin,
            assignedAt: activeTag.assignedAt,
        } : null,
        vehicleDetails:{
            registrationNum: resource.vehicleDetail?.registrationNum ?? null,
            vehicleColour: resource.vehicleDetail?.vehicleColour ?? null,
        },
        recentCalls,
        calls: recentCalls,
        communications: recentCalls,
    }
}

const modifyResourceById = async (resourceId : string, userId: string, updateVal:string) => {
    const updatedResource = await prisma.resource.update({
        where:{
            id: resourceId,
            userId,
            active: true
        },
        data:{
            name : updateVal
        }
    })
    return {
        id: updatedResource.id,
        name: updatedResource.name
    };
}

const deleteResourceById = async (
    resourceId: string,
    userId: string,
) => {
    const resource = await prisma.resource.findFirst({
        where: {
            id: resourceId,
            userId,
            active: true,
        },
    });

    if (!resource) {
        throw new NotFoundError("Resource not found or already deleted");
    }

    const now = new Date();

    // Perform atomic soft deletion + QR unpairing + ContactLink deactivation
    await prisma.$transaction(async (tx) => {
        // 1. Soft-delete the resource
        await tx.resource.update({
            where: { id: resourceId },
            data: { active: false },
        });

        // 2. Deactivate any associated ContactLink
        await tx.contactLink.updateMany({
            where: { resourceId },
            data: { active: false },
        });

        // 3. Cleanly unpair and release any associated QR tag back to UNASSIGNED
        const linkedTags = await tx.qrTag.findMany({
            where: { resourceId },
        });

        for (const tag of linkedTags) {
            // Close active assignment audit log
            await tx.qrAssignment.updateMany({
                where: {
                    qrTagId: tag.id,
                    resourceId,
                    unassignedAt: null,
                },
                data: {
                    unassignedAt: now,
                },
            });

            // Unlock and release tag back to UNASSIGNED so it can be re-paired
            await tx.qrTag.update({
                where: { id: tag.id },
                data: {
                    status: QrTagStatus.UNASSIGNED,
                    resourceId: null,
                    assignmentMethod: null,
                    assignedAt: null,
                },
            });
        }
    });

    return {
        success: true,
        message: "Resource deleted and associated QR tags successfully unlinked.",
    };
};






const getResourceCalls = async (resourceId: string, userId: string, page = 1, limit = 20) => {
    const isAdmin = await checkIsAdmin(userId);
    const resource = await prisma.resource.findFirst({
        where: {
            id: resourceId,
            ...(isAdmin ? {} : { userId }),
            active: true,
        },
        select: {
            id: true,
            name: true,
        },
    });

    if (!resource) {
        throw new NotFoundError("Resource not found");
    }

    const skip = (page - 1) * limit;

    const [total, sessions] = await prisma.$transaction([
        prisma.communicationSession.count({
            where: { resourceId },
        }),
        prisma.communicationSession.findMany({
            where: { resourceId },
            skip,
            take: limit,
            orderBy: { createdAt: "desc" },
            include: {
                calls: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                },
            },
        }),
    ]);

    const calls = sessions.map((s) => {
        const latestCall = s.calls?.[0];
        const durationSec = latestCall?.durationSec ?? 0;
        const lastTwo = getCallerLastTwoDigits(s.contactorPhoneNumber);
        return {
            id: s.id,
            sessionId: s.id,
            caller: lastTwo ? `Visitor (••${lastTwo})` : "Anonymous Visitor",
            callerLastTwo: lastTwo || null,
            status: latestCall?.status ?? s.status,
            durationSec,
            duration: formatDuration(durationSec),
            createdAt: s.createdAt,
            incomingAt: latestCall?.incomingAt ?? s.createdAt,
            connectedAt: latestCall?.connectedAt ?? null,
            endedAt: latestCall?.endedAt ?? s.endedAt,
            type: s.type,
        };
    });

    return {
        resourceId: resource.id,
        resourceName: resource.name,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        calls,
    };
};

const getResourceAnalytics = async (resourceId: string, userId: string) => {
  const isAdmin = await checkIsAdmin(userId);
  const resource = await prisma.resource.findFirst({
    where: {
      id: resourceId,
      ...(isAdmin ? {} : { userId }),
      active: true,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!resource) {
    throw new NotFoundError("Resource not found");
  }

  const [
    totalVisits,
    qrScans,
    shareVisits,
    directVisits,
    callsInitiated,
    callsCompleted,
    deviceBreakdown,
    recentVisits,
  ] = await prisma.$transaction([
    prisma.tagVisit.count({ where: { resourceId } }),
    prisma.tagVisit.count({ where: { resourceId, source: "QR_SCAN" } }),
    prisma.tagVisit.count({ where: { resourceId, source: "SHARE" } }),
    prisma.tagVisit.count({ where: { resourceId, source: "DIRECT" } }),
    prisma.communicationSession.count({ where: { resourceId } }),
    prisma.communicationCall.count({
      where: {
        session: { resourceId },
        status: "COMPLETED",
      },
    }),
    prisma.tagVisit.groupBy({
      by: ["deviceType"],
      where: { resourceId },
      _count: { deviceType: true },
      orderBy: { _count: { deviceType: "desc" } },
    }),
    prisma.tagVisit.findMany({
      where: { resourceId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        source: true,
        deviceType: true,
        os: true,
        browser: true,
        createdAt: true,
      },
    }),
  ]);

  // Hourly distribution in IST (Asia/Kolkata)
  const hourlyRaw: Array<{ hour: number; count: bigint }> = await prisma.$queryRaw`
    SELECT 
      CAST(EXTRACT(HOUR FROM "createdAt" AT TIME ZONE 'Asia/Kolkata') AS INTEGER) AS hour,
      COUNT(*)::bigint AS count
    FROM "TagVisit"
    WHERE "resourceId" = ${resourceId}::uuid
    GROUP BY hour
    ORDER BY hour ASC;
  `;

  const hourlyDistribution = Array.from({ length: 24 }, (_, i) => {
    const match = hourlyRaw.find((h) => Number(h.hour) === i);
    return {
      hour: i,
      label: `${i.toString().padStart(2, "0")}:00`,
      visits: match ? Number(match.count) : 0,
    };
  });

  const conversionRate =
    totalVisits > 0 ? Number(((callsInitiated / totalVisits) * 100).toFixed(1)) : 0;

  return {
    resourceId: resource.id,
    resourceName: resource.name,
    summary: {
      totalVisits,
      qrScans,
      shareVisits,
      directVisits,
      callsInitiated,
      callsCompleted,
      conversionRate,
    },
    deviceBreakdown: deviceBreakdown.map((d) => ({
      deviceType: d.deviceType,
      count: typeof d._count === "object" && d._count !== null ? d._count.deviceType ?? 0 : 0,
    })),

    hourlyDistribution,
    recentVisits,
  };
};


export {
    createResource,
    deleteResourceById,
    getResourceById,
    getResources,
    modifyResourceById,
    getResourceCalls,
    getResourceAnalytics,
};

