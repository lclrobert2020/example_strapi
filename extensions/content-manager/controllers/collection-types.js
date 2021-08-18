'use strict';

const { has, pipe, prop, pick } = require('lodash/fp');
const { MANY_RELATIONS } = require('strapi-utils').relations.constants;

const appDictionary = ({})

const requiredFilteringModelArray = ['application::post.post']
const requiredAddingApplicationTypes = ['application::post.post']

const isModelRequiredFiltering = (arg) => {
  return requiredFilteringModelArray.filter((e, i) => e === arg).length > 0
}

const isModelRequiredAddingApplicationTypes = (arg) => {
  return requiredAddingApplicationTypes.filter((e, i) => e === arg).length > 0
}

const {
  getService,
  wrapBadRequest,
  setCreatorFields,
  pickWritableAttributes,
} = require('../utils');
const { validateBulkDeleteInput, validatePagination } = require('./validation');

module.exports = {
  async find(ctx) {
    const { userAbility } = ctx.state;
    const { model } = ctx.params;
    let { query } = ctx.request;
    const isUserHasDefaultSystemRole = ctx.state?.user?.roles.filter((e, i) => e.name === 'Super Admin' || e.name === "Editor" || e.name === "Author").length > 0//assume the default system role of strapi (Super Admin, Editor and Author) doesn't need to hide any information according to the Application Type  
    if (!isUserHasDefaultSystemRole && isModelRequiredFiltering(model)) {
      // add filtering base on application type here
      let roleName = ctx.state?.user?.roles[0].name
      if (roleName.includes("ChildApp")) {
        let ChildAppId = roleName.match(/\d+/) ? roleName.match(/\d+/)[0] : null;
        if (ChildAppId) {
          let wherePhase = { _where: [{ 'application_types.title_containss': `ChildApp_${ChildAppId}` }]}
          if (!query["_where"]) {
            query = { ...query, ...wherePhase }
          } else {
            let whereQueryFiltered = JSON.parse(JSON.stringify(query["_where"])).filter((e, i) => {
              return Object.keys(e).join("|").toLowerCase().includes('application_types')? false:true;
            })
            query = { ...query, _where: [...whereQueryFiltered, ...wherePhase["_where"]] }
          }
        }
      }
    }
  const entityManager = getService('entity-manager');
  const permissionChecker = getService('permission-checker').create({ userAbility, model });

  if(permissionChecker.cannot.read()) {
  return ctx.forbidden();
}

const method = has('_q', query) ? 'searchWithRelationCounts' : 'findWithRelationCounts';

const permissionQuery = permissionChecker.buildReadQuery(query);

const { results, pagination } = await entityManager[method](permissionQuery, model);

ctx.body = {
  results: results.map(entity => permissionChecker.sanitizeOutput(entity)),
  pagination,
};
  },

async findOne(ctx) {
  const { userAbility } = ctx.state;
  const { model, id } = ctx.params;

  const entityManager = getService('entity-manager');
  const permissionChecker = getService('permission-checker').create({ userAbility, model });

  if (permissionChecker.cannot.read()) {
    return ctx.forbidden();
  }

  const entity = await entityManager.findOneWithCreatorRoles(id, model);

  if (!entity) {
    return ctx.notFound();
  }

  if (permissionChecker.cannot.read(entity)) {
    return ctx.forbidden();
  }

  ctx.body = permissionChecker.sanitizeOutput(entity);
},

async create(ctx) {
  const { userAbility, user } = ctx.state;
  const { model } = ctx.params;
  let { body } = ctx.request;
  console.log(body, model)
  let addApplication_types = (number) =>{ return {application_types: [ Number(number) ]}}
  let roles = user.roles
  console.log(user.roles)
  const isUserHasDefaultSystemRole = ctx.state?.user?.roles.filter((e, i) => e.name === 'Super Admin' || e.name === "Editor" || e.name === "Author").length > 0//assume the default system role of strapi (Super Admin, Editor and Author) doesn't need to hide any information according to the Application Type  
  let add = {};
  
  if (!isUserHasDefaultSystemRole && isModelRequiredAddingApplicationTypes(model)){
      let roleName = ctx.state?.user?.roles[0].name
      if (roleName.includes("ChildApp")) {
        let ChildAppId = roleName.match(/\d+/) ? roleName.match(/\d+/)[0] : null;
        if (ChildAppId) {
          let z = await strapi.query("application-type").find({title:`ChildApp_${ChildAppId}`})
          if(z.length>0){
            add = addApplication_types(z[0].id)
          }
        }
      }
  }
  const entityManager = getService('entity-manager');
  const permissionChecker = getService('permission-checker').create({ userAbility, model });

  if (permissionChecker.cannot.create()) {
    return ctx.forbidden();
  }

  const pickWritables = pickWritableAttributes({ model });
  const pickPermittedFields = permissionChecker.sanitizeCreateInput;
  const setCreator = setCreatorFields({ user });

  const sanitizeFn = pipe([pickWritables, pickPermittedFields, setCreator]);
  await wrapBadRequest(async () => {
    const entity = await entityManager.create({...sanitizeFn(body), ...add}, model);
    ctx.body = permissionChecker.sanitizeOutput(entity);
    await strapi.telemetry.send('didCreateFirstContentTypeEntry', { model });
  })();
},

async update(ctx) {
  const { userAbility, user } = ctx.state;
  const { id, model } = ctx.params;
  const { body } = ctx.request;

  const entityManager = getService('entity-manager');
  const permissionChecker = getService('permission-checker').create({ userAbility, model });

  if (permissionChecker.cannot.update()) {
    return ctx.forbidden();
  }

  const entity = await entityManager.findOneWithCreatorRoles(id, model);

  if (!entity) {
    return ctx.notFound();
  }

  if (permissionChecker.cannot.update(entity)) {
    return ctx.forbidden();
  }

  const pickWritables = pickWritableAttributes({ model });
  const pickPermittedFields = permissionChecker.sanitizeUpdateInput(entity);
  const setCreator = setCreatorFields({ user, isEdition: true });

  const sanitizeFn = pipe([pickWritables, pickPermittedFields, setCreator]);

  await wrapBadRequest(async () => {
    const updatedEntity = await entityManager.update(entity, sanitizeFn(body), model);

    ctx.body = permissionChecker.sanitizeOutput(updatedEntity);
  })();
},

async delete (ctx) {
  const { userAbility } = ctx.state;
  const { id, model } = ctx.params;

  const entityManager = getService('entity-manager');
  const permissionChecker = getService('permission-checker').create({ userAbility, model });

  if (permissionChecker.cannot.delete()) {
    return ctx.forbidden();
  }

  const entity = await entityManager.findOneWithCreatorRoles(id, model);

  if (!entity) {
    return ctx.notFound();
  }

  if (permissionChecker.cannot.delete(entity)) {
    return ctx.forbidden();
  }

  const result = await entityManager.delete(entity, model);

  ctx.body = permissionChecker.sanitizeOutput(result);
},

async publish(ctx) {
  const { userAbility } = ctx.state;
  const { id, model } = ctx.params;

  const entityManager = getService('entity-manager');
  const permissionChecker = getService('permission-checker').create({ userAbility, model });

  if (permissionChecker.cannot.publish()) {
    return ctx.forbidden();
  }

  const entity = await entityManager.findOneWithCreatorRoles(id, model);

  if (!entity) {
    return ctx.notFound();
  }

  if (permissionChecker.cannot.publish(entity)) {
    return ctx.forbidden();
  }

  const result = await entityManager.publish(entity, model);

  ctx.body = permissionChecker.sanitizeOutput(result);
},

async unpublish(ctx) {
  const { userAbility } = ctx.state;
  const { id, model } = ctx.params;

  const entityManager = getService('entity-manager');
  const permissionChecker = getService('permission-checker').create({ userAbility, model });

  if (permissionChecker.cannot.unpublish()) {
    return ctx.forbidden();
  }

  const entity = await entityManager.findOneWithCreatorRoles(id, model);

  if (!entity) {
    return ctx.notFound();
  }

  if (permissionChecker.cannot.unpublish(entity)) {
    return ctx.forbidden();
  }

  const result = await entityManager.unpublish(entity, model);

  ctx.body = permissionChecker.sanitizeOutput(result);
},

async bulkDelete(ctx) {
  const { userAbility } = ctx.state;
  const { model } = ctx.params;
  const { query, body } = ctx.request;
  const { ids } = body;

  await validateBulkDeleteInput(body);

  const entityManager = getService('entity-manager');
  const permissionChecker = getService('permission-checker').create({ userAbility, model });

  if (permissionChecker.cannot.delete()) {
    return ctx.forbidden();
  }

  const permissionQuery = permissionChecker.buildDeleteQuery(query);

  const idsWhereClause = { [`id_in`]: ids };
  const params = {
    ...permissionQuery,
    _where: [idsWhereClause].concat(permissionQuery._where || {}),
  };

  const results = await entityManager.findAndDelete(params, model);

  ctx.body = results.map(result => permissionChecker.sanitizeOutput(result));
},

async previewManyRelations(ctx) {
  const { userAbility } = ctx.state;
  const { model, id, targetField } = ctx.params;
  const { pageSize = 10, page = 1 } = ctx.request.query;

  validatePagination({ page, pageSize });

  const contentTypeService = getService('content-types');
  const entityManager = getService('entity-manager');
  const permissionChecker = getService('permission-checker').create({ userAbility, model });

  if (permissionChecker.cannot.read()) {
    return ctx.forbidden();
  }

  const modelDef = strapi.getModel(model);
  const assoc = modelDef.associations.find(a => a.alias === targetField);

  if (!assoc || !MANY_RELATIONS.includes(assoc.nature)) {
    return ctx.badRequest('Invalid target field');
  }

  const entity = await entityManager.findOneWithCreatorRoles(id, model);

  if (!entity) {
    return ctx.notFound();
  }

  if (permissionChecker.cannot.read(entity, targetField)) {
    return ctx.forbidden();
  }

  let relationList;
  if (assoc.nature === 'manyWay') {
    const populatedEntity = await entityManager.findOne(id, model, [targetField]);
    const relationsListIds = populatedEntity[targetField].map(prop('id'));
    relationList = await entityManager.findPage(
      { page, pageSize, id_in: relationsListIds },
      assoc.targetUid
    );
  } else {
    const assocModel = strapi.db.getModelByAssoc(assoc);
    relationList = await entityManager.findPage(
      { page, pageSize, [`${assoc.via}.${assocModel.primaryKey}`]: entity.id },
      assoc.targetUid
    );
  }

  const config = await contentTypeService.findConfiguration({ uid: model });
  const mainField = prop(['metadatas', assoc.alias, 'edit', 'mainField'], config);

  ctx.body = {
    pagination: relationList.pagination,
    results: relationList.results.map(pick(['id', modelDef.primaryKey, mainField])),
  };
},
};
