import express from "express";
import asyncHandler from "express-async-handler";
import { createResource, deleteResourceById, getResourceById, getResources, modifyResourceById, createContactLink } from "./resources.services.js";
import { BadRequestError } from "../../errors/AppError.js";

/**
 * @description Create new user resource
 * @route POST /api/resources
 * @access public
 */
const createResourceController = asyncHandler (async (req, res, next) => {
    const resource = await createResource(
        req.user.id,
        req.body.name
    )
    res.status(201).json(resource);
})
/**
 * @description Create new resource contact-link
 * @route POST /api/resources/:id/contact-link
 * @access public
 */
 const createContactLinkController = asyncHandler (async (req, res, next) => {
    const {id} = req.params;

    if(typeof id !== "string"){
        throw new BadRequestError("Resource ID is required");
    }
    const contactLink = await createContactLink(
        id,
        req.user.id
    );
    res.status(200).json(contactLink);

 })




/**
 * @description Get all resources temp route
 * @route GET /api/resources
 * @access private
 */
const getResourceController = asyncHandler (async(req, res, next) => {
    const resources = await getResources(
        req.user.id
    );
    res.status(200).json(resources);
})

/**
 * @description Get particular resource by id
 * @route GET /api/resources/:id
 * @access private
 */
const getResourceByIdController = asyncHandler (async (req, res, next) => {
    const {id} = req.params;

    if(typeof id !== "string"){
        throw new BadRequestError("Resource ID is required");
    }
    const resource = await getResourceById(
        id,
        req.user.id
    )
    res.status(200).json(resource);
})

/**
 * @description Modiy particular resource by id
 * @route PATCH /api/resources/:id
 * @access private
 */
const modifyResourceByIdController = asyncHandler (async (req, res, next) => {
    const {id} = req.params;

    if(typeof id !== "string"){
        throw new BadRequestError("Resource ID is required");
    }
    const updatedResource = await modifyResourceById(
        id,
        req.user.id,
        req.body.name
    )
    res.status(200).json(updatedResource);
})

/**
 * @description Delete particular resource by id
 * @route DELETE /api/resources/:id
 * @access private
 */
const deleteResourceByIdController = asyncHandler (async (req, res, next) => {
    const {id} = req.params;

    if(typeof id !== "string"){
        throw new BadRequestError("Resource ID is required");
    }
    await deleteResourceById(
        id,
        req.user.id
    )

    res.status(204).send()
})
















export {
    createResourceController,
    getResourceController,
    getResourceByIdController,
    modifyResourceByIdController,
    deleteResourceByIdController,
    createContactLinkController
}