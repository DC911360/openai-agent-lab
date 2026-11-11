

import { getCityCoordinates } from "./get-city-coordinates.js";
import { getCityCoordinatesDefinition } from './definition.js'

import { Tool, GetCityCoordinatesInput, GetCityCoordinatesResult } from '../too.type.js';

export const  getCityCoordinatesTool:Tool<GetCityCoordinatesInput,GetCityCoordinatesResult> = {
    definition: getCityCoordinatesDefinition,
    execute: getCityCoordinates
}